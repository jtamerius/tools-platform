#!/usr/bin/env bash
# setup-maritime.sh — One-time bootstrap for the maritime AIS pipeline.
#
# Run this once after the CloudFormation stack has been deployed to staging or
# production. It:
#   1. Creates the ECR repository for the processing container.
#   2. Builds the Docker image (infra/apps/maritime-trajectory/Dockerfile)
#      and pushes it to ECR.
#   3. Uploads the SageMaker processing script (src/processing/ais_merge.py)
#      to the scripts/ prefix of the AIS input bucket.
#   4. Creates a minimal AVIS vessel-metadata seed CSV and uploads it to the
#      avis/ prefix. Replace this with real AVIS data when available.
#   5. Syncs a sample AIS dataset from the NOAA MarineCadastre public S3
#      bucket to the raw/ prefix of the AIS input bucket.
#
# Usage:
#   ./infra/scripts/setup-maritime.sh <environment> [ais-source-uri]
#
# Arguments:
#   environment      staging | production
#   ais-source-uri   (optional) S3 URI of the source AIS data to sync.
#                    Defaults to one month of Zone 10 data (US West Coast)
#                    from the NOAA public dataset for 2023.
#                    Override with your own s3:// path if you have data staged.
#
# Prerequisites:
#   - aws CLI v2 (configured with credentials that can create ECR repos and
#     access SSM parameters)
#   - docker (running locally)
#   - Bash >= 4
#
# The ECR repository (tools-maritime-processing) is shared across environments
# because container images are environment-agnostic; only the stack and data
# differ between staging and production.

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────
ENV="${1:-}"

if [[ -z "$ENV" ]]; then
  echo "Usage: $0 <environment> [ais-source-uri]"
  echo ""
  echo "  environment:     staging | production"
  echo "  ais-source-uri:  (optional) s3://... path to sync AIS data from"
  echo ""
  echo "Example:"
  echo "  $0 staging"
  echo "  $0 staging s3://noaa-ais-pds/AIS_ASCII_by_UTM_Month/2023/AIS_2023_01_Zone10.csv"
  exit 1
fi

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "ERROR: environment must be 'staging' or 'production', got: '$ENV'" >&2
  exit 1
fi

# NOAA MarineCadastre AIS — one month of US West Coast (Zone 10) data for 2023.
# Zone 10 covers roughly Washington → Northern California offshore waters.
# The noaa-ais-pds bucket is a public AWS Open Data dataset (no credentials needed).
# See https://registry.opendata.aws for the full dataset listing.
# Override by passing a second argument if you want a different zone or year.
DEFAULT_AIS_SOURCE="s3://noaa-ais-pds/AIS_ASCII_by_UTM_Month/2023/AIS_2023_01_Zone10.csv"
AIS_SOURCE_URI="${2:-$DEFAULT_AIS_SOURCE}"

# ─── Configuration ────────────────────────────────────────────────────────────
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO_NAME="tools-maritime-processing"
IMAGE_URI="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME:latest"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKERFILE="$REPO_ROOT/infra/apps/maritime-trajectory/Dockerfile"
PROCESSING_SCRIPT="$REPO_ROOT/src/processing/ais_merge.py"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()  { echo "[$(date -u '+%H:%M:%S')] $*"; }
info() { log "INFO  $*"; }
ok()   { log "OK    $*"; }
err()  { log "ERROR $*" >&2; }
die()  { err "$*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1. Please install it and retry."
}

# ─── Pre-flight ───────────────────────────────────────────────────────────────
require_cmd aws
require_cmd docker

[[ -f "$DOCKERFILE" ]]         || die "Dockerfile not found: $DOCKERFILE"
[[ -f "$PROCESSING_SCRIPT" ]]  || die "Processing script not found: $PROCESSING_SCRIPT"

info "=== Maritime AIS pipeline bootstrap ==="
info "  Environment : $ENV"
info "  Account     : $ACCOUNT"
info "  Region      : $REGION"
info "  AIS source  : $AIS_SOURCE_URI"

# ─── Read bucket names from SSM ───────────────────────────────────────────────
info "Reading bucket names from SSM Parameter Store..."

INPUT_BUCKET=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/ais-input-bucket" \
  --region "$REGION" \
  --query "Parameter.Value" \
  --output text 2>/dev/null) \
  || die "Could not read /tools/$ENV/maritime/ais-input-bucket from SSM. Has the CloudFormation stack been deployed?"

OUTPUT_BUCKET=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/processed-output-bucket" \
  --region "$REGION" \
  --query "Parameter.Value" \
  --output text 2>/dev/null) \
  || die "Could not read /tools/$ENV/maritime/processed-output-bucket from SSM."

info "  Input bucket  : $INPUT_BUCKET"
info "  Output bucket : $OUTPUT_BUCKET"

# ─── Step 1: Create ECR repository ───────────────────────────────────────────
info "--- Step 1: ECR repository ---"

EXISTING=$(aws ecr describe-repositories \
  --repository-names "$REPO_NAME" \
  --region "$REGION" \
  --query "repositories[0].repositoryUri" \
  --output text 2>/dev/null || echo "")

if [[ -z "$EXISTING" || "$EXISTING" == "None" ]]; then
  info "Creating ECR repository: $REPO_NAME"
  aws ecr create-repository \
    --repository-name "$REPO_NAME" \
    --image-scanning-configuration scanOnPush=true \
    --region "$REGION" \
    --no-cli-pager
  ok "ECR repository created."
else
  info "ECR repository already exists: $EXISTING"
fi

# ─── Step 2: Build and push Docker image ─────────────────────────────────────
info "--- Step 2: Build and push container image ---"

# Authenticate Docker to the SageMaker base image registry (account 683313688378)
# so Docker can pull the base layer during build.
info "Logging in to SageMaker base image registry (683313688378)..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin \
  "683313688378.dkr.ecr.$REGION.amazonaws.com"

# Authenticate Docker to our own ECR registry for the push.
info "Logging in to our ECR registry ($ACCOUNT)..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin \
  "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

info "Building image: $IMAGE_URI"
docker build \
  --platform linux/amd64 \
  --tag "$IMAGE_URI" \
  --file "$DOCKERFILE" \
  "$REPO_ROOT/infra/apps/maritime-trajectory"

info "Pushing image: $IMAGE_URI"
docker push "$IMAGE_URI"
ok "Image pushed: $IMAGE_URI"

# ─── Step 3: Upload processing script ────────────────────────────────────────
info "--- Step 3: Upload processing script ---"

aws s3 cp "$PROCESSING_SCRIPT" \
  "s3://$INPUT_BUCKET/scripts/ais_merge.py" \
  --region "$REGION" \
  --no-cli-pager

ok "Script uploaded → s3://$INPUT_BUCKET/scripts/ais_merge.py"

# ─── Step 4: Seed minimal AVIS vessel metadata ───────────────────────────────
# This CSV provides a representative sample of vessel types for the join.
# Replace with a full AVIS export from NOAA NMFS when available.
# The processing script performs a left join, so pings for unknown MMSIs will
# still appear in the output with null vessel dimensions and VesselGroup=Unknown.
info "--- Step 4: Seed AVIS vessel metadata ---"

AVIS_TMP=$(mktemp /tmp/avis_seed.XXXXXX.csv)
cat > "$AVIS_TMP" <<'AVIS_EOF'
MMSI,IMO,Draft,Length,Width,VesselType
366123456,1234567,12.5,294,32,70
366234567,2345678,7.2,185,28,80
366345678,3456789,4.1,52,10,30
338123456,4567890,6.8,137,22,71
338234567,5678901,9.3,224,30,82
367123456,6789012,3.5,45,9,37
366456789,7890123,11.0,275,40,70
338345678,8901234,8.5,160,24,80
AVIS_EOF

aws s3 cp "$AVIS_TMP" \
  "s3://$INPUT_BUCKET/avis/avis_seed.csv" \
  --region "$REGION" \
  --no-cli-pager

rm -f "$AVIS_TMP"
ok "AVIS seed uploaded → s3://$INPUT_BUCKET/avis/avis_seed.csv"

# ─── Step 5: Sync AIS sample data ────────────────────────────────────────────
info "--- Step 5: Sync AIS data ---"
info "  Source : $AIS_SOURCE_URI"
info "  Dest   : s3://$INPUT_BUCKET/raw/"
info "(This may take a few minutes depending on file size)"

# --no-sign-request allows reads from the public NOAA bucket without credentials.
# If the source is a private bucket you own, remove that flag.
if [[ "$AIS_SOURCE_URI" == s3://noaa-ais-pds/* ]]; then
  aws s3 cp "$AIS_SOURCE_URI" \
    "s3://$INPUT_BUCKET/raw/" \
    --no-sign-request \
    --region "$REGION" \
    --no-cli-pager
else
  aws s3 cp "$AIS_SOURCE_URI" \
    "s3://$INPUT_BUCKET/raw/" \
    --region "$REGION" \
    --no-cli-pager
fi

ok "AIS data synced → s3://$INPUT_BUCKET/raw/"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Bootstrap complete. Run the pipeline with:"
echo ""
echo "  bash infra/scripts/run-maritime-pipeline.sh $ENV"
echo ""
echo "  Container image : $IMAGE_URI"
echo "  Input bucket    : $INPUT_BUCKET"
echo "  Output bucket   : $OUTPUT_BUCKET"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

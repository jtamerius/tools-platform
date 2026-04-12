#!/usr/bin/env bash
# setup-maritime.sh — One-time bootstrap for the maritime AIS pipeline.
#
# Run this once after the CDK stack has been deployed to staging or production.
# It:
#   1. Creates a minimal AVIS vessel-metadata seed CSV and uploads it to the
#      avis/ prefix of the AIS input bucket.
#   2. Syncs a sample AIS dataset from the NOAA MarineCadastre public S3
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
#
# Prerequisites:
#   - aws CLI v2 with a profile that can read SSM and write to S3

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────
ENV="${1:-}"

if [[ -z "$ENV" ]]; then
  echo "Usage: $0 <environment> [ais-source-uri]"
  echo ""
  echo "  environment:     staging | production"
  echo "  ais-source-uri:  (optional) s3://... path to copy AIS data from"
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
DEFAULT_AIS_SOURCE="s3://noaa-ais-pds/AIS_ASCII_by_UTM_Month/2023/AIS_2023_01_Zone10.csv"
AIS_SOURCE_URI="${2:-$DEFAULT_AIS_SOURCE}"

# ─── Configuration ────────────────────────────────────────────────────────────
REGION="${AWS_REGION:-us-east-1}"

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

info "=== Maritime AIS pipeline bootstrap ==="
info "  Environment : $ENV"
info "  Region      : $REGION"
info "  AIS source  : $AIS_SOURCE_URI"

# ─── Read bucket names from SSM ───────────────────────────────────────────────
info "Reading bucket names from SSM Parameter Store..."

INPUT_BUCKET=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/ais-input-bucket" \
  --region "$REGION" \
  --query "Parameter.Value" \
  --output text 2>/dev/null) \
  || die "Could not read /tools/$ENV/maritime/ais-input-bucket from SSM. Has the CDK stack been deployed?"

OUTPUT_BUCKET=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/processed-output-bucket" \
  --region "$REGION" \
  --query "Parameter.Value" \
  --output text 2>/dev/null) \
  || die "Could not read /tools/$ENV/maritime/processed-output-bucket from SSM."

info "  Input bucket  : $INPUT_BUCKET"
info "  Output bucket : $OUTPUT_BUCKET"

# ─── Step 1: Seed minimal AVIS vessel metadata ───────────────────────────────
# This CSV provides a representative sample of vessel types for the join.
# Replace with a full AVIS export from NOAA NMFS when available.
# The ETL Lambda performs a left join, so pings for unknown MMSIs will
# still appear in the output with null vessel dimensions and VesselGroup=Unknown.
info "--- Step 1: Seed AVIS vessel metadata ---"

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

# ─── Step 2: Sync AIS sample data ────────────────────────────────────────────
info "--- Step 2: Copy AIS data ---"
info "  Source : $AIS_SOURCE_URI"
info "  Dest   : s3://$INPUT_BUCKET/raw/"
info "(This may take a few minutes for large files)"

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

ok "AIS data copied → s3://$INPUT_BUCKET/raw/"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Bootstrap complete. Run the pipeline with:"
echo ""
echo "  bash infra/scripts/run-maritime-pipeline.sh $ENV"
echo ""
echo "  Input bucket  : $INPUT_BUCKET"
echo "  Output bucket : $OUTPUT_BUCKET"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

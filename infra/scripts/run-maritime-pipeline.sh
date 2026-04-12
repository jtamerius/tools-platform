#!/usr/bin/env bash
# run-maritime-pipeline.sh — Start a maritime AIS pipeline Step Functions execution.
#
# Reads the processing configuration from SSM Parameter Store (populated by the
# CloudFormation stack) and starts a single execution of the Step Functions state
# machine that runs the SageMaker AIS merge + segmentation Processing Job.
#
# Usage:
#   ./infra/scripts/run-maritime-pipeline.sh <environment> [instance-type]
#
# Arguments:
#   environment    staging | production
#   instance-type  (optional) SageMaker instance type. Default: ml.m5.xlarge
#
# Prerequisites:
#   - aws CLI v2
#   - setup-maritime.sh must have been run at least once (container + data in S3)
#
# After starting, the script prints the execution ARN and polls until the
# execution reaches a terminal state (SUCCEEDED, FAILED, TIMED_OUT, ABORTED).
# Execution logs are streamed to CloudWatch Logs group:
#   /tools/maritime/sfn-pipeline-<environment>

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────
ENV="${1:-}"
INSTANCE_TYPE="${2:-ml.m5.xlarge}"

if [[ -z "$ENV" ]]; then
  echo "Usage: $0 <environment> [instance-type]"
  echo ""
  echo "  environment:    staging | production"
  echo "  instance-type:  SageMaker instance type (default: ml.m5.xlarge)"
  echo ""
  echo "Examples:"
  echo "  $0 staging"
  echo "  $0 staging ml.m5.2xlarge"
  exit 1
fi

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "ERROR: environment must be 'staging' or 'production', got: '$ENV'" >&2
  exit 1
fi

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

POLL_INTERVAL=20
MAX_WAIT=7200   # 2 hours

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()  { echo "[$(date -u '+%H:%M:%S')] $*"; }
info() { log "INFO  $*"; }
ok()   { log "OK    $*"; }
err()  { log "ERROR $*" >&2; }
die()  { err "$*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

# ─── Pre-flight ───────────────────────────────────────────────────────────────
require_cmd aws

info "=== Maritime AIS pipeline trigger ==="
info "  Environment   : $ENV"
info "  Instance type : $INSTANCE_TYPE"
info "  Region        : $REGION"

# ─── Read configuration from SSM ─────────────────────────────────────────────
info "Reading configuration from SSM..."

INPUT_BUCKET=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/ais-input-bucket" \
  --region "$REGION" --query "Parameter.Value" --output text 2>/dev/null) \
  || die "Could not read input bucket from SSM. Has the stack been deployed?"

OUTPUT_BUCKET=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/processed-output-bucket" \
  --region "$REGION" --query "Parameter.Value" --output text 2>/dev/null) \
  || die "Could not read output bucket from SSM."

STATE_MACHINE_ARN=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/state-machine-arn" \
  --region "$REGION" --query "Parameter.Value" --output text 2>/dev/null) \
  || die "Could not read state machine ARN from SSM."

IMAGE_URI="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/tools-maritime-processing:latest"

info "  Input bucket      : $INPUT_BUCKET"
info "  Output bucket     : $OUTPUT_BUCKET"
info "  State machine ARN : $STATE_MACHINE_ARN"
info "  Container image   : $IMAGE_URI"

# ─── Verify prerequisites ─────────────────────────────────────────────────────
info "Checking S3 prerequisites..."

SCRIPT_EXISTS=$(aws s3 ls "s3://$INPUT_BUCKET/scripts/ais_merge.py" \
  --region "$REGION" 2>/dev/null | wc -l | tr -d ' ')
[[ "$SCRIPT_EXISTS" -gt 0 ]] \
  || die "Processing script not found at s3://$INPUT_BUCKET/scripts/ais_merge.py. Run setup-maritime.sh first."

AIS_FILES=$(aws s3 ls "s3://$INPUT_BUCKET/raw/" \
  --region "$REGION" 2>/dev/null | wc -l | tr -d ' ')
[[ "$AIS_FILES" -gt 0 ]] \
  || die "No AIS files found at s3://$INPUT_BUCKET/raw/. Run setup-maritime.sh first."

AVIS_FILES=$(aws s3 ls "s3://$INPUT_BUCKET/avis/" \
  --region "$REGION" 2>/dev/null | wc -l | tr -d ' ')
[[ "$AVIS_FILES" -gt 0 ]] \
  || die "No AVIS metadata files found at s3://$INPUT_BUCKET/avis/. Run setup-maritime.sh first."

ok "Found $AIS_FILES AIS file(s) and $AVIS_FILES AVIS file(s). Proceeding."

# ─── Build execution input ────────────────────────────────────────────────────
EXECUTION_INPUT=$(cat <<JSON
{
  "AisInputPrefix":      "s3://$INPUT_BUCKET/raw/",
  "AvisInputUri":        "s3://$INPUT_BUCKET/avis/",
  "OutputPrefix":        "s3://$OUTPUT_BUCKET/master-record/",
  "ProcessingScriptUri": "s3://$INPUT_BUCKET/scripts/",
  "ProcessingImageUri":  "$IMAGE_URI",
  "InstanceType":        "$INSTANCE_TYPE"
}
JSON
)

# ─── Start Step Functions execution ──────────────────────────────────────────
info "Starting Step Functions execution..."

EXECUTION_ARN=$(aws stepfunctions start-execution \
  --state-machine-arn "$STATE_MACHINE_ARN" \
  --input "$EXECUTION_INPUT" \
  --region "$REGION" \
  --query "executionArn" \
  --output text)

info "Execution started: $EXECUTION_ARN"
info ""
info "CloudWatch Logs: /tools/maritime/sfn-pipeline-$ENV"
info "AWS Console: https://console.aws.amazon.com/states/home?region=$REGION#/executions/details/$EXECUTION_ARN"
info ""
info "Polling for completion (max ${MAX_WAIT}s)..."

# ─── Poll until terminal state ────────────────────────────────────────────────
ELAPSED=0

while true; do
  STATUS=$(aws stepfunctions describe-execution \
    --execution-arn "$EXECUTION_ARN" \
    --region "$REGION" \
    --query "status" \
    --output text 2>/dev/null || echo "UNKNOWN")

  info "  Status: $STATUS  (${ELAPSED}s elapsed)"

  case "$STATUS" in
    SUCCEEDED)
      ok "Pipeline execution succeeded."
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  Output data location:"
      echo "  s3://$OUTPUT_BUCKET/master-record/"
      echo ""
      echo "  Preview the output partitions:"
      echo "  aws s3 ls s3://$OUTPUT_BUCKET/master-record/ --recursive"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      exit 0
      ;;
    FAILED|TIMED_OUT|ABORTED)
      err "Pipeline execution ended with status: $STATUS"
      err "Check CloudWatch Logs for the SageMaker job details:"
      err "  /aws/sagemaker/ProcessingJobs  (job name starts with 'ais-merge-')"
      err "  /tools/maritime/sfn-pipeline-$ENV"
      exit 1
      ;;
    RUNNING)
      ;;
    *)
      info "  Unrecognised status '$STATUS' — continuing to poll..."
      ;;
  esac

  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    err "Timed out after ${MAX_WAIT}s. Execution may still be running:"
    err "  $EXECUTION_ARN"
    exit 1
  fi

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

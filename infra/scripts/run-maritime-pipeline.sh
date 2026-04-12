#!/usr/bin/env bash
# run-maritime-pipeline.sh — Invoke the maritime AIS ETL Lambda synchronously.
#
# Reads the ETL function name from SSM Parameter Store (populated by the CDK
# stack) and invokes it, then polls the response for success/failure.
#
# Usage:
#   ./infra/scripts/run-maritime-pipeline.sh <environment>
#
# Arguments:
#   environment    staging | production
#
# Prerequisites:
#   - aws CLI v2
#   - setup-maritime.sh must have been run first (data in S3)

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────
ENV="${1:-}"

if [[ -z "$ENV" ]]; then
  echo "Usage: $0 <environment>"
  echo ""
  echo "  environment:  staging | production"
  echo ""
  echo "Examples:"
  echo "  $0 staging"
  echo "  $0 production"
  exit 1
fi

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "ERROR: environment must be 'staging' or 'production', got: '$ENV'" >&2
  exit 1
fi

REGION="${AWS_REGION:-us-east-1}"
RESPONSE_TMP=$(mktemp /tmp/lambda_response.XXXXXX.json)
trap 'rm -f "$RESPONSE_TMP"' EXIT

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
info "  Environment : $ENV"
info "  Region      : $REGION"

# ─── Read configuration from SSM ─────────────────────────────────────────────
info "Reading configuration from SSM..."

ETL_FUNCTION=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/etl-function-name" \
  --region "$REGION" --query "Parameter.Value" --output text 2>/dev/null) \
  || die "Could not read ETL function name from SSM. Has the CDK stack been deployed?"

INPUT_BUCKET=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/ais-input-bucket" \
  --region "$REGION" --query "Parameter.Value" --output text 2>/dev/null) \
  || die "Could not read input bucket from SSM."

OUTPUT_BUCKET=$(aws ssm get-parameter \
  --name "/tools/$ENV/maritime/processed-output-bucket" \
  --region "$REGION" --query "Parameter.Value" --output text 2>/dev/null) \
  || die "Could not read output bucket from SSM."

info "  ETL function  : $ETL_FUNCTION"
info "  Input bucket  : $INPUT_BUCKET"
info "  Output bucket : $OUTPUT_BUCKET"

# ─── Verify prerequisites ─────────────────────────────────────────────────────
info "Checking S3 prerequisites..."

AIS_FILES=$(aws s3 ls "s3://$INPUT_BUCKET/raw/" \
  --region "$REGION" 2>/dev/null | wc -l | tr -d ' ')
[[ "$AIS_FILES" -gt 0 ]] \
  || die "No AIS files found at s3://$INPUT_BUCKET/raw/. Run setup-maritime.sh first."

AVIS_FILES=$(aws s3 ls "s3://$INPUT_BUCKET/avis/" \
  --region "$REGION" 2>/dev/null | wc -l | tr -d ' ')
[[ "$AVIS_FILES" -gt 0 ]] \
  || die "No AVIS metadata files found at s3://$INPUT_BUCKET/avis/. Run setup-maritime.sh first."

ok "Found $AIS_FILES AIS file(s) and $AVIS_FILES AVIS file(s). Proceeding."

# ─── Invoke ETL Lambda ────────────────────────────────────────────────────────
info "Invoking ETL Lambda (timeout up to 15 min — please wait)..."

# Lambda invoke is synchronous by default (InvocationType=RequestResponse).
# The CLI will wait up to 15 minutes for the response.
HTTP_STATUS=$(aws lambda invoke \
  --function-name "$ETL_FUNCTION" \
  --region "$REGION" \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  --query "StatusCode" \
  --output text \
  "$RESPONSE_TMP" 2>&1)

RESPONSE_BODY=$(cat "$RESPONSE_TMP")
info "  HTTP status: $HTTP_STATUS"

# Check for Lambda-level error (FunctionError in response)
FUNCTION_ERROR=$(aws lambda invoke \
  --function-name "$ETL_FUNCTION" \
  --region "$REGION" \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  "$RESPONSE_TMP" \
  --query "FunctionError" \
  --output text 2>/dev/null || echo "None")

# Re-read the final response
RESPONSE_BODY=$(cat "$RESPONSE_TMP")

if [[ "$FUNCTION_ERROR" != "None" && -n "$FUNCTION_ERROR" ]]; then
  err "Lambda returned a function error:"
  echo "$RESPONSE_BODY" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE_BODY"
  exit 1
fi

# Parse the statusCode from the Lambda response body
INNER_STATUS=$(echo "$RESPONSE_BODY" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    body = json.loads(r.get('body', '{}'))
    print(r.get('statusCode', 0))
    import sys
    if r.get('statusCode') == 200:
        print(f'  pings:   {body.get(\"pings\", \"?\")}', file=sys.stderr)
        print(f'  trips:   {body.get(\"trips\", \"?\")}', file=sys.stderr)
        print(f'  vessels: {body.get(\"vessels\", \"?\")}', file=sys.stderr)
except Exception as exc:
    print(0)
    print(f'Parse error: {exc}', file=sys.stderr)
" 2>/tmp/etl_stats)

cat /tmp/etl_stats || true

if [[ "$INNER_STATUS" == "200" ]]; then
  ok "ETL completed successfully."
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Output data location:"
  echo "  s3://$OUTPUT_BUCKET/master-record/"
  echo ""
  echo "  Preview the output partitions:"
  echo "  aws s3 ls s3://$OUTPUT_BUCKET/master-record/ --recursive --region $REGION"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  err "ETL Lambda returned a non-200 status. Full response:"
  echo "$RESPONSE_BODY" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE_BODY"
  exit 1
fi

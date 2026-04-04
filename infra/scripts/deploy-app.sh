#!/usr/bin/env bash
# deploy-app.sh — Deploy app-specific infrastructure then trigger an Amplify build.
#
# Usage:
#   ./infra/scripts/deploy-app.sh <app-name> <environment>
#
# Arguments:
#   app-name     Directory name under infra/apps/, e.g. landing-page
#   environment  staging | production
#
# What it does:
#   1. Deploys infra/apps/<app-name>/template.yaml as stack tools-app-<app>-<env>.
#      Cognito UserPoolId / UserPoolClientId are read from the shared cognito
#      stack's outputs and passed in as parameter overrides automatically.
#   2. Triggers an Amplify RELEASE job for the app.
#      Amplify App ID is resolved (in priority order) from:
#        a. AMPLIFY_APP_ID environment variable
#        b. CloudFormation output of the shared amplify stack
#        c. SSM parameter /tools/<env>/amplify/<app-name>/app-id
#   3. Polls until the job succeeds, fails, or times out (15 min).
#
# Requires: aws CLI v2, bash >= 4
# AWS credentials must be configured before running.

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────
APP_NAME="${1:-}"
ENV="${2:-}"

if [[ -z "$APP_NAME" || -z "$ENV" ]]; then
  echo "Usage: $0 <app-name> <environment>"
  echo ""
  echo "  app-name:    e.g. landing-page"
  echo "  environment: staging | production"
  echo ""
  echo "Example:"
  echo "  $0 landing-page staging"
  exit 1
fi

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "ERROR: environment must be 'staging' or 'production', got: '$ENV'" >&2
  exit 1
fi

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INFRA_DIR="$REPO_ROOT/infra"
TEMPLATE_FILE="$INFRA_DIR/apps/$APP_NAME/template.yaml"

REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="tools-app-$APP_NAME-$ENV"

# Amplify branch: production → "main", staging → "staging"
if [[ "$ENV" == "production" ]]; then
  AMPLIFY_BRANCH="main"
else
  AMPLIFY_BRANCH="$ENV"
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()  { echo "[$(date -u '+%H:%M:%S')] $*"; }
info() { log "INFO  $*"; }
ok()   { log "OK    $*"; }
err()  { log "ERROR $*" >&2; }

die() {
  err "$*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

print_stack_status() {
  local stack_name="$1"
  local status
  status=$(aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --region "$REGION" \
    --query "Stacks[0].StackStatus" \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")
  info "Stack '$stack_name' status: $status"

  if [[ "$status" == *FAILED* || "$status" == *ROLLBACK* ]]; then
    info "Recent FAILED events:"
    aws cloudformation describe-stack-events \
      --stack-name "$stack_name" \
      --region "$REGION" \
      --query "StackEvents[?ResourceStatus=='CREATE_FAILED' || ResourceStatus=='UPDATE_FAILED' || ResourceStatus=='DELETE_FAILED'].[Timestamp,LogicalResourceId,ResourceStatusReason]" \
      --output table 2>/dev/null | head -40 || true
  fi
}

# ─── Pre-flight checks ───────────────────────────────────────────────────────
require_cmd aws

[[ -f "$TEMPLATE_FILE" ]] || die "CloudFormation template not found: $TEMPLATE_FILE"

info "=== Deploying app '$APP_NAME' to environment: $ENV ==="

# ─── Resolve Cognito IDs from shared stack ────────────────────────────────────
info "Reading Cognito outputs from stack 'tools-shared-cognito-$ENV'..."

USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "tools-shared-cognito-$ENV" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text 2>/dev/null || true)

USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name "tools-shared-cognito-$ENV" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text 2>/dev/null || true)

[[ -n "$USER_POOL_ID" ]]        || die "Could not read UserPoolId from tools-shared-cognito-$ENV. Deploy the cognito stack first."
[[ -n "$USER_POOL_CLIENT_ID" ]] || die "Could not read UserPoolClientId from tools-shared-cognito-$ENV. Deploy the cognito stack first."

info "  UserPoolId       : $USER_POOL_ID"
info "  UserPoolClientId : $USER_POOL_CLIENT_ID"

# ─── Deploy app-specific CloudFormation stack ─────────────────────────────────
info "Deploying app infrastructure stack: $STACK_NAME"
info "  Template : $TEMPLATE_FILE"
info "  Region   : $REGION"

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE_FILE" \
  --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --region "$REGION" \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "Environment=$ENV" \
    "UserPoolId=$USER_POOL_ID" \
    "UserPoolClientId=$USER_POOL_CLIENT_ID"

print_stack_status "$STACK_NAME"
ok "Stack '$STACK_NAME' deployed."

# ─── Resolve Amplify App ID ───────────────────────────────────────────────────
# Priority: env var → shared amplify stack output → SSM parameter
if [[ -z "${AMPLIFY_APP_ID:-}" ]]; then
  info "AMPLIFY_APP_ID not set; checking shared amplify stack output..."
  AMPLIFY_APP_ID=$(aws cloudformation describe-stacks \
    --stack-name "tools-shared-amplify-$ENV" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='AmplifyAppId'].OutputValue" \
    --output text 2>/dev/null || true)
fi

if [[ -z "${AMPLIFY_APP_ID:-}" ]]; then
  SSM_KEY="/tools/$ENV/amplify/$APP_NAME/app-id"
  info "Not found in stack outputs; checking SSM parameter: $SSM_KEY"
  AMPLIFY_APP_ID=$(aws ssm get-parameter \
    --name "$SSM_KEY" \
    --region "$REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || true)
fi

if [[ -z "${AMPLIFY_APP_ID:-}" ]]; then
  info "No Amplify App ID found — skipping frontend deployment trigger."
  info "Set the AMPLIFY_APP_ID environment variable, or deploy the shared amplify stack first."
  exit 0
fi

# ─── Trigger Amplify RELEASE job ─────────────────────────────────────────────
info "Triggering Amplify deployment:"
info "  App ID : $AMPLIFY_APP_ID"
info "  Branch : $AMPLIFY_BRANCH"

JOB_ID=$(aws amplify start-job \
  --app-id "$AMPLIFY_APP_ID" \
  --branch-name "$AMPLIFY_BRANCH" \
  --job-type RELEASE \
  --region "$REGION" \
  --query "jobSummary.jobId" \
  --output text)

info "Amplify job started: $JOB_ID"
info "Polling for completion (max 15 minutes)..."

POLL_INTERVAL=15
MAX_WAIT=900
ELAPSED=0

while true; do
  STATUS=$(aws amplify get-job \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name "$AMPLIFY_BRANCH" \
    --job-id "$JOB_ID" \
    --region "$REGION" \
    --query "job.summary.status" \
    --output text 2>/dev/null || echo "UNKNOWN")

  info "  Job status: $STATUS  (${ELAPSED}s elapsed)"

  case "$STATUS" in
    SUCCEED)
      ok "Amplify deployment succeeded."
      break
      ;;
    FAILED|CANCELLED)
      err "Amplify deployment $STATUS."
      err "Review the build log: https://console.aws.amazon.com/amplify/home#/$AMPLIFY_APP_ID/$AMPLIFY_BRANCH/$JOB_ID"
      exit 1
      ;;
    RUNNING|PENDING|PROVISIONING)
      # Still in progress — keep polling
      ;;
    *)
      info "  Unrecognised status '$STATUS'; continuing to poll..."
      ;;
  esac

  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    err "Timed out after ${MAX_WAIT}s waiting for Amplify job $JOB_ID to complete."
    err "Check the Amplify console: https://console.aws.amazon.com/amplify/"
    exit 1
  fi

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

info "=== App '$APP_NAME' deployed to $ENV ==="

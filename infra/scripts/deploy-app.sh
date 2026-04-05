#!/usr/bin/env bash
# deploy-app.sh — Deploy app-specific infrastructure (SSM parameters) for one app.
#
# Usage:
#   ./infra/scripts/deploy-app.sh <app-name> <environment>
#
# Arguments:
#   app-name     Directory name under infra/apps/, e.g. landing-page
#   environment  staging | production
#
# What it does:
#   Deploys infra/apps/<app-name>/template.yaml as stack tools-app-<app>-<env>.
#   Cognito UserPoolId / UserPoolClientId are read from the shared cognito
#   stack's outputs and passed in as parameter overrides automatically.
#   The stack writes SSM parameters that GHA reads at build time to inject
#   Cognito config into the Vite build.
#
# Note: Amplify deployment is handled by GitHub Actions (GHA builds the
#   artifacts and calls create-deployment / start-deployment). This script
#   only manages app-specific CloudFormation infrastructure.
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

# Amplify branch name (used in info message only)
AMPLIFY_BRANCH="$( [[ "$ENV" == "production" ]] && echo main || echo "$ENV" )"

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

info "=== App '$APP_NAME' infra deployed to $ENV ==="
info ""
info "SSM parameters written — GHA will read these at build time to inject Cognito config."
info "To deploy the frontend, push to the '$AMPLIFY_BRANCH' branch or run /amplify-deploy."

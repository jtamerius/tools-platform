#!/usr/bin/env bash
# deploy-shared.sh — Deploy all shared infrastructure stacks in dependency order.
#
# Usage:
#   ./infra/scripts/deploy-shared.sh <environment> <github-oauth-token>
#
# Arguments:
#   environment         staging | production
#   github-oauth-token  GitHub PAT with repo scope for Amplify source connection.
#                       On subsequent runs, pass the existing token or retrieve
#                       it from AWS Secrets Manager before calling this script.
#
# Stacks deployed (in order):
#   1. tools-shared-iam-<env>      — OIDC role + Amplify service role
#   2. tools-shared-cognito-<env>  — Cognito User Pool + groups
#   3. tools-shared-dns-<env>      — ACM certificates (must deploy to us-east-1)
#   4. tools-shared-amplify-<env>  — Amplify app + branch
#
# Requires: aws CLI v2, bash >= 4
# AWS credentials must be configured before running (e.g. via OIDC or aws configure).

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────
ENV="${1:-}"
GITHUB_OAUTH_TOKEN="${2:-}"

if [[ -z "$ENV" || -z "$GITHUB_OAUTH_TOKEN" ]]; then
  echo "Usage: $0 <environment> <github-oauth-token>"
  echo ""
  echo "  environment:         staging | production"
  echo "  github-oauth-token:  GitHub PAT with repo scope (NoEcho)"
  echo ""
  echo "Example:"
  echo "  $0 staging ghp_xxxxxxxxxxxx"
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
PARAMS_FILE="$INFRA_DIR/environments/$ENV/params.json"

# ACM for Amplify/CloudFront must be in us-east-1
REGION="${AWS_REGION:-us-east-1}"

# ─── Arguments (optional) ────────────────────────────────────────────────────
ALERT_EMAIL="${3:-}"

# ─── Stack names ─────────────────────────────────────────────────────────────
STACK_IAM="tools-shared-iam-$ENV"
STACK_COGNITO="tools-shared-cognito-$ENV"
STACK_DNS="tools-shared-dns-$ENV"
STACK_AMPLIFY="tools-shared-amplify-$ENV"
STACK_MONITORING="tools-shared-monitoring-$ENV"

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

# Print a stack's status and the most recent failed resource event (if any)
print_stack_status() {
  local stack_name="$1"
  local status
  status=$(aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --region "$REGION" \
    --query "Stacks[0].StackStatus" \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")
  info "Stack '$stack_name' status: $status"

  # Surface any FAILED resource events to aid debugging
  if [[ "$status" == *FAILED* || "$status" == *ROLLBACK* ]]; then
    info "Recent FAILED events:"
    aws cloudformation describe-stack-events \
      --stack-name "$stack_name" \
      --region "$REGION" \
      --query "StackEvents[?ResourceStatus=='CREATE_FAILED' || ResourceStatus=='UPDATE_FAILED' || ResourceStatus=='DELETE_FAILED'].[Timestamp,LogicalResourceId,ResourceStatusReason]" \
      --output table 2>/dev/null | head -40 || true
  fi
}

# Deploy a CloudFormation stack using `aws cloudformation deploy`.
# Arguments: stack-name template-file [ParameterKey=Value ...]
deploy_stack() {
  local stack_name="$1"
  local template_file="$2"
  shift 2
  local extra_overrides=("$@")

  [[ -f "$template_file" ]] || die "Template not found: $template_file"

  info "──────────────────────────────────────────────"
  info "Deploying stack: $stack_name"
  info "  Template : $template_file"
  info "  Region   : $REGION"

  aws cloudformation deploy \
    --stack-name "$stack_name" \
    --template-file "$template_file" \
    --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
    --region "$REGION" \
    --no-fail-on-empty-changeset \
    --parameter-overrides "${extra_overrides[@]+"${extra_overrides[@]}"}"

  print_stack_status "$stack_name"
  ok "Stack '$stack_name' deployed successfully."
}

# ─── Pre-flight checks ───────────────────────────────────────────────────────
require_cmd aws

[[ -f "$PARAMS_FILE" ]] || die "Params file not found: $PARAMS_FILE"

# Extract HostedZoneId from the environment params file
HOSTED_ZONE_ID=$(python3 -c "
import json, sys
try:
    params = json.load(open('$PARAMS_FILE'))
    for p in params:
        if p['ParameterKey'] == 'HostedZoneId':
            print(p['ParameterValue'])
            sys.exit(0)
    sys.exit(1)
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
" 2>/dev/null) || die "Could not read HostedZoneId from $PARAMS_FILE"

if [[ "$HOSTED_ZONE_ID" == "REPLACE_WITH_HOSTED_ZONE_ID" || -z "$HOSTED_ZONE_ID" ]]; then
  die "HostedZoneId is not set in $PARAMS_FILE. Edit the file and replace REPLACE_WITH_HOSTED_ZONE_ID with your actual Route 53 hosted zone ID."
fi

info "=== Deploying shared infrastructure for environment: $ENV ==="
info "Hosted Zone ID: $HOSTED_ZONE_ID"

# ─── 1. IAM stack ────────────────────────────────────────────────────────────
# OIDC provider and IAM roles must exist before other stacks reference their exports.
deploy_stack "$STACK_IAM" \
  "$INFRA_DIR/shared/iam/template.yaml" \
  "Environment=$ENV"

# ─── 2. Cognito stack ────────────────────────────────────────────────────────
deploy_stack "$STACK_COGNITO" \
  "$INFRA_DIR/shared/cognito/template.yaml" \
  "Environment=$ENV"

# ─── 3. DNS / ACM stack ──────────────────────────────────────────────────────
# NOTE: Must be deployed to us-east-1 (Amplify Hosting / CloudFront requirement).
deploy_stack "$STACK_DNS" \
  "$INFRA_DIR/shared/dns/template.yaml" \
  "Environment=$ENV" \
  "HostedZoneId=$HOSTED_ZONE_ID"

# ─── 4. Amplify stack ────────────────────────────────────────────────────────
# Depends on IAM exports (AmplifyServiceRoleArn).
deploy_stack "$STACK_AMPLIFY" \
  "$INFRA_DIR/shared/amplify/template.yaml" \
  "Environment=$ENV" \
  "GitHubOAuthToken=$GITHUB_OAUTH_TOKEN"

# ─── 5. Monitoring stack ─────────────────────────────────────────────────────
# Optional — only deployed when ALERT_EMAIL is provided.
if [[ -n "$ALERT_EMAIL" ]]; then
  info "Deploying monitoring stack (alert email: $ALERT_EMAIL)"
  deploy_stack "$STACK_MONITORING" \
    "$INFRA_DIR/shared/monitoring/template.yaml" \
    "Environment=$ENV" \
    "AlertEmail=$ALERT_EMAIL"
else
  info "Skipping monitoring stack (pass alert email as 3rd arg to enable):"
  info "  $0 $ENV <github-token> you@example.com"
fi

# ─── Done ────────────────────────────────────────────────────────────────────
info "=== All shared stacks deployed for environment: $ENV ==="
info ""
info "Next steps:"
info "  1. Run deploy-app.sh to deploy app-specific infra (SSM params):"
info "       ./infra/scripts/deploy-app.sh landing-page $ENV"
info "  2. Configure the custom domain in the Amplify console:"
info "       https://console.aws.amazon.com/amplify/"
info "  3. After SSM params are written, trigger a fresh Amplify build."

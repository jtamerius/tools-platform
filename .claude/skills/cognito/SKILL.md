---
name: cognito
description: Manage Cognito users — create a user, add/remove from a group, list users, reset a password, or show pool info. Usage: /cognito <action> [args]
argument-hint: "create <email> | add-to-group <email> <group> | remove-from-group <email> <group> | list [group] | reset-password <email> | info"
allowed-tools: Bash(aws *)
---

# Cognito User Management

Parse `$ARGUMENTS` as `<action> [args]`.

## User Pool IDs

| Environment | User Pool ID |
|-------------|-------------|
| staging | `us-east-1_Ia0QTCZTw` |
| production | (check `tools-shared-cognito-production-UserPoolId` export) |

Default to **staging** unless the action includes `production`.

---

## Actions

### `info`
Show User Pool details and group membership counts.
```bash
AWS_PROFILE=jtam aws cognito-idp describe-user-pool \
  --user-pool-id us-east-1_Ia0QTCZTw \
  --region us-east-1 --no-cli-pager \
  --query 'UserPool.{Name:Name,Status:Status,Users:EstimatedNumberOfUsers}'
```

### `list [group]`
List users (optionally filtered to a group: `admin`, `member`, `guest`).
```bash
# All users:
AWS_PROFILE=jtam aws cognito-idp list-users \
  --user-pool-id us-east-1_Ia0QTCZTw \
  --region us-east-1 --no-cli-pager \
  --query "Users[*].[Username,UserStatus,Attributes[?Name=='email'].Value|[0]]" \
  --output table

# Users in a specific group:
AWS_PROFILE=jtam aws cognito-idp list-users-in-group \
  --user-pool-id us-east-1_Ia0QTCZTw \
  --group-name {group} \
  --region us-east-1 --no-cli-pager \
  --query "Users[*].[Username,UserStatus,Attributes[?Name=='email'].Value|[0]]" \
  --output table
```

### `create <email>`
Create a user with a temporary password (they'll be prompted to change on first login).
```bash
AWS_PROFILE=jtam aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_Ia0QTCZTw \
  --username {email} \
  --user-attributes Name=email,Value={email} Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --region us-east-1 --no-cli-pager
```
Report the temporary password Cognito sends to the email.

### `add-to-group <email> <group>`
Add a user to a group (`admin`, `member`, or `guest`).
```bash
AWS_PROFILE=jtam aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_Ia0QTCZTw \
  --username {email} \
  --group-name {group} \
  --region us-east-1 --no-cli-pager
```

### `remove-from-group <email> <group>`
Remove a user from a group.
```bash
AWS_PROFILE=jtam aws cognito-idp admin-remove-user-from-group \
  --user-pool-id us-east-1_Ia0QTCZTw \
  --username {email} \
  --group-name {group} \
  --region us-east-1 --no-cli-pager
```

### `reset-password <email>`
Force a password reset — user gets a verification code at their email.
```bash
AWS_PROFILE=jtam aws cognito-idp admin-reset-user-password \
  --user-pool-id us-east-1_Ia0QTCZTw \
  --username {email} \
  --region us-east-1 --no-cli-pager
```

### `disable <email>` / `enable <email>`
Disable or re-enable a user account.
```bash
AWS_PROFILE=jtam aws cognito-idp admin-disable-user \
  --user-pool-id us-east-1_Ia0QTCZTw \
  --username {email} \
  --region us-east-1 --no-cli-pager
```

---

**Groups:** `admin` (full access), `member` (finance-app access), `guest` (limited)
**If SSO token expired**, run `/sso` first then retry.

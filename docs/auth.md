# Authentication Guide

All apps in this platform share a single AWS Cognito User Pool per environment. This document covers the User Pool structure, group-based access control, how the frontend hooks into Cognito, token lifecycle, and administrative operations.

---

## Cognito User Pool Structure

One User Pool is deployed per environment by `infra/shared/cognito/template.yaml`:

- **Staging:** `tools-platform-staging`
- **Production:** `tools-platform-production`

### Key Settings

| Setting | Value |
|---------|-------|
| Username attribute | Email address |
| Email verification | Code-based |
| Self sign-up | Enabled (users can register themselves) |
| MFA | Optional (TOTP software token only) |
| Password minimum length | 8 characters |
| Password requirements | Upper + lower + numbers (no symbols required) |
| Temporary password validity | 7 days |
| Account recovery | Verified email |

### App Client

Each User Pool has a single app client (`tools-platform-spa-{env}`) configured for SPA use:

- **No client secret** — browser apps cannot keep secrets; the client ID is public by design
- **Auth flows:** `USER_SRP_AUTH`, `USER_PASSWORD_AUTH`, `REFRESH_TOKEN_AUTH`
- Token revocation enabled

---

## Groups

Three groups are pre-created by CloudFormation. Group precedence controls which group "wins" when a user belongs to multiple groups (lower number = higher precedence).

| Group | Precedence | Purpose |
|-------|-----------|---------|
| `admin` | 1 | Full platform access. Can manage users and see all apps. |
| `member` | 2 | Standard authenticated access. Default group for invited users. |
| `guest` | 3 | Limited / read-only access. For users you want to share specific content with. |

Groups are stored as a claim in the ID token (`cognito:groups`). The frontend reads this claim — there is no server-side enforcement for purely static apps.

---

## How the Frontend Checks Auth

### The `useAuth` Hook

Located at `shared/auth/src/useAuth.js` and mirrored in `apps/landing-page/src/hooks/useAuth.js`.

```js
const { user, groups, isLoading, signIn, signOut } = useAuth()
```

| Property | Type | Description |
|----------|------|-------------|
| `user` | `{ username, email } \| null` | Currently signed-in user, or `null` |
| `groups` | `string[]` | Array of Cognito group names for the user |
| `isLoading` | `boolean` | `true` while the initial session check is running |
| `signIn` | `(email, password) => Promise<void>` | Signs in and updates state |
| `signOut` | `() => void` | Signs out and clears state |

### Session Initialization

On mount, `useAuth` reads the current Cognito session from `localStorage` (managed by `amazon-cognito-identity-js`). If a valid session exists the user and groups are set immediately — no network round-trip needed. If expired, `getSession()` automatically attempts a refresh using the stored refresh token.

### Sign-In Flow

```js
try {
  await signIn(email, password)
  // user and groups are now populated
} catch (err) {
  // err.message is safe to show in the UI
}
```

On success, Cognito returns an ID token, access token, and refresh token. These are stored in `localStorage` by the SDK. The groups claim is parsed from the ID token JWT payload.

---

## Making an App Public vs Protected

### Public App

Set `isPublic: true` in `apps/landing-page/src/config/apps.js`. The landing page will show the app card to unauthenticated users.

For the app itself — if it should be fully public (no sign-in required), simply do not call `useAuth` or gate any content on group membership.

### Protected App (any authenticated user)

```jsx
import { useAuth } from '../hooks/useAuth'

export default function ProtectedPage() {
  const { user, isLoading } = useAuth()

  if (isLoading) return <LoadingSpinner />
  if (!user) return <SignInPrompt />

  return <div>Protected content here</div>
}
```

### Requiring a Specific Group

```jsx
import { useAuth } from '../hooks/useAuth'

export default function AdminPage() {
  const { user, groups, isLoading } = useAuth()

  if (isLoading) return <LoadingSpinner />
  if (!user) return <SignInPrompt />
  if (!groups.includes('admin')) return <AccessDenied />

  return <div>Admin-only content</div>
}
```

To require `member` or higher (i.e., `member` OR `admin`):

```js
const hasAccess = groups.includes('member') || groups.includes('admin')
```

Since `admin` users are not automatically in the `member` group, check for both if you want to allow all non-guest authenticated users.

---

## Invite-Based vs Self-Signup Flow

The User Pool currently has `SelfSignUpEnabled: true`. This means anyone with an email address can register at the sign-in modal.

**Important:** Self-signed-up users receive no groups by default. They can authenticate but any group-protected content will be inaccessible until an admin adds them to a group.

### Disabling Self-Signup (Invite-Only)

To switch to invite-only, update `infra/shared/cognito/template.yaml`:

```yaml
AdminCreateUserConfig:
  AllowAdminCreateUserOnly: true   # change from false
```

Deploy the updated stack. After this change, only an admin (via the AWS Console or CLI) can create new users. Cognito sends them a temporary password by email.

---

## How to Add a User to a Group

### AWS CLI

```bash
# Add user to the 'member' group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --group-name member \
  --region us-east-1

# Add user to 'admin'
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --group-name admin \
  --region us-east-1

# List groups for a user
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --region us-east-1

# Remove user from a group
aws cognito-idp admin-remove-user-from-group \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --group-name member \
  --region us-east-1
```

The User Pool ID is available from the CloudFormation stack output:

```bash
aws cloudformation describe-stacks \
  --stack-name tools-shared-cognito-production \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text
```

### Creating an Admin-Invited User

```bash
# Create user (sends temporary password email)
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --user-attributes Name=email,Value=user@example.com Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --region us-east-1

# Then add them to a group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --group-name member \
  --region us-east-1
```

---

## Token Lifecycle and Refresh

| Token | Validity | Notes |
|-------|---------|-------|
| ID token | 1 hour | Contains user identity + groups claim |
| Access token | 1 hour | Used for Cognito API calls (not currently used by the SPA) |
| Refresh token | 30 days | Used to get new ID/access tokens without re-login |

### How Refresh Works

`amazon-cognito-identity-js` handles token refresh automatically. When `getSession()` is called (which `useAuth` does on mount), the SDK checks if the tokens are within the expiry window. If the ID/access tokens are expired but the refresh token is still valid, the SDK silently fetches new tokens using the refresh token.

If the refresh token is expired (after 30 days of inactivity), the user must sign in again.

### Signing Out

`signOut()` calls `CognitoUser.signOut()`, which removes tokens from `localStorage` and revokes the refresh token server-side (because `EnableTokenRevocation: true` is set on the app client). Previously issued access/ID tokens remain technically valid until their 1-hour expiry, but the session cannot be refreshed.

### Force Sign-Out All Devices

To immediately invalidate all sessions for a user (e.g., compromised account):

```bash
aws cognito-idp admin-user-global-sign-out \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --region us-east-1
```

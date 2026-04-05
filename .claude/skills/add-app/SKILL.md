---
name: add-app
description: Scaffold a new app in the tools platform. Creates the app directory with Vite+React boilerplate, a CloudFormation Amplify stack, and registers it in the landing-page app registry.
argument-hint: "<app-id> <display-name> <subdomain> [public|member|admin]"
---

# Add a New App to the Platform

Parse `$ARGUMENTS` as `<app-id> <display-name> <subdomain> [access-level]`:
- `app-id`: kebab-case identifier, e.g. `my-tool` (used for directory name, stack name, npm package name)
- `display-name`: human-readable, e.g. `My Tool`
- `subdomain`: DNS subdomain, e.g. `my-tool` → `my-tool.jtamerius.com`
- `access-level`: `public` (default), `member`, or `admin`

## Files to create

### 1. `apps/{app-id}/package.json`
Mirror `apps/weather-app/package.json` (if public, no auth) or `apps/finance-app/package.json` (if auth-gated).
Change:
- `"name": "@tools/{app-id}"`
- Remove/add `@tools/auth` dependency based on access level

### 2. `apps/{app-id}/vite.config.js`
Copy from `apps/landing-page/vite.config.js` verbatim.

### 3. `apps/{app-id}/index.html`
Copy from `apps/landing-page/index.html`, update `<title>` to `{display-name}`.

### 4. `apps/{app-id}/src/main.jsx`, `src/index.css`
Copy verbatim from `apps/landing-page/src/`.

### 5. `apps/{app-id}/src/App.jsx`
- If **public**: simple wrapper, no auth. Model after `apps/weather-app/src/App.jsx`.
- If **auth-gated**: `useAuth` + `SignInModal`. Model after `apps/finance-app/src/App.jsx`.

### 6. `apps/{app-id}/src/pages/HomePage.jsx`
Minimal placeholder page component.

### 7. `apps/{app-id}/src/components/Nav.jsx`
Use the shared Nav from `@tools/ui` — see `/nav-standard` for the exact pattern.
- If **public**: `<Nav appTitle="{display-name}" currentAppId="{app-id}" />`
- If **auth-gated**: pass `user`, `onSignIn`, `onSignOut` props as well

### 8. `infra/shared/amplify/{app-id}-template.yaml`
Copy `apps/weather-app`'s template (`infra/shared/amplify/weather-app-template.yaml`), replace:
- All `WeatherApp` → `{PascalCase app-id}`
- `tools-weather-app-${Environment}` → `tools-{app-id}-${Environment}`
- `tools-shared-amplify-weather-` → `tools-shared-amplify-{app-id}-`
- `Prefix: weather` → `Prefix: {subdomain}`
- URL comment: `{subdomain}.jtamerius.com`

## Files to modify

### `shared/config/src/apps.js`
Add an entry to the `APPS` array (this is the authoritative registry, shared by all apps):
```js
{
  id: '{app-id}',
  name: '{display-name}',
  description: 'TODO: add description',
  url: 'https://{subdomain}.jtamerius.com',
  subdomain: '{subdomain}',
  isPublic: {true if public, false otherwise},
  requiredGroup: {null if public, 'member' if member, 'admin' if admin},
},
```

### `infra/scripts/deploy-shared.sh`
Add a new step after the last `deploy_stack` call:
```bash
# ─── 4d. Amplify stack ({app-id}) ────────────────────────
deploy_stack "tools-shared-amplify-{app-id}-$ENV" \
  "$INFRA_DIR/shared/amplify/{app-id}-template.yaml" \
  "Environment=$ENV"
```

### `.github/workflows/deploy-production.yml` and `deploy-staging.yml`
Add a new detect-changes filter and a new deploy job (Job N) mirroring the weather-app job pattern. Use the appropriate SSM Cognito fetching if auth is needed.

### `.github/workflows/ci.yml`
Add the new app to the `detect-changes` filters and add a lint/test/build job.

---

After scaffolding, tell the user:
1. The files created/modified
2. That they need to run `npm install` in the new app directory
3. That they need to run `/deploy-shared {env}` to create the Amplify stack
4. That they need to add `AMPLIFY_APP_ID_{APP_ID_UPPER}` to GitHub secrets after deploying stacks

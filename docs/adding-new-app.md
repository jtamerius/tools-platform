# Adding a New App

This guide walks through every step required to add a new internal tool to the platform. By the end the app will be:

- Built and deployed automatically on push to `staging`
- Deployed to production with manual approval on push to `production`
- Listed on the landing page at `tools.jtamerius.com`
- Protected by Cognito authentication (or public, your choice)
- Served from `<app-name>.jtamerius.com`

---

## Step 1 — Scaffold the App

Create the app directory and initialize a Vite + React project:

```bash
cd apps
npm create vite@latest <app-name> -- --template react
cd <app-name>
npm install
```

Install the shared auth package so you can reuse the `useAuth` hook:

```bash
npm install ../../shared/auth
```

Your directory should look like:

```
apps/<app-name>/
├── index.html
├── package.json
├── vite.config.js
├── amplify.yml          ← you will create this in Step 2
├── .env.example         ← you will create this
└── src/
    ├── main.jsx
    ├── App.jsx
    └── hooks/
        └── useAuth.js   ← import from shared/auth or copy from apps/landing-page
```

Create `.env.example`:

```bash
cat > .env.example << 'EOF'
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_ENV=staging
EOF
```

---

## Step 2 — Add `amplify.yml`

Amplify uses this file to know where the app root is within the monorepo and how to build it.

Create `apps/<app-name>/amplify.yml`:

```yaml
version: 1
applications:
  - appRoot: apps/<app-name>
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: dist
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
```

---

## Step 3 — Create the App Infrastructure Stack

Create `infra/apps/<app-name>/template.yaml`. At minimum this stack writes the Cognito IDs to SSM so Amplify can resolve them at build time:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: >
  App-specific infrastructure for <app-name>.

Parameters:
  Environment:
    Type: String
    AllowedValues:
      - staging
      - production

  UserPoolId:
    Type: String
    AllowedPattern: '[a-z]{2}-[a-z]+-[0-9]_[A-Za-z0-9]+'

  UserPoolClientId:
    Type: String
    AllowedPattern: '[a-z0-9]+'

Resources:

  SSMUserPoolId:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub '/tools/${Environment}/<app-name>/cognito/user-pool-id'
      Type: String
      Value: !Ref UserPoolId
      Description: !Sub 'Cognito User Pool ID for <app-name> (${Environment})'
      Tags:
        Environment: !Ref Environment
        Project: tools-platform
        App: <app-name>

  SSMClientId:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub '/tools/${Environment}/<app-name>/cognito/client-id'
      Type: String
      Value: !Ref UserPoolClientId
      Tags:
        Environment: !Ref Environment
        Project: tools-platform
        App: <app-name>

Outputs:
  SSMUserPoolIdPath:
    Value: !Ref SSMUserPoolId
    Export:
      Name: !Sub 'tools-app-<app-name>-${Environment}-SSMUserPoolIdPath'

  SSMClientIdPath:
    Value: !Ref SSMClientId
    Export:
      Name: !Sub 'tools-app-<app-name>-${Environment}-SSMClientIdPath'
```

Replace `<app-name>` with your actual app name throughout.

---

## Step 4 — Add the Amplify App to the Shared Amplify Stack

Open `infra/shared/amplify/template.yaml` and add a new `AWS::Amplify::App` and `AWS::Amplify::Branch` resource for your app, following the pattern used for `LandingPageAmplifyApp`. Key fields to customize:

```yaml
  <AppName>AmplifyApp:
    Type: AWS::Amplify::App
    Properties:
      Name: !Sub 'tools-<app-name>-${Environment}'
      Repository: https://github.com/jtamerius/portfolio
      OauthToken: !Ref GitHubOAuthToken
      IAMServiceRole: !ImportValue
        'Fn::Sub': 'tools-shared-iam-${Environment}-AmplifyServiceRoleArn'
      BuildSpec: |
        version: 1
        applications:
          - appRoot: apps/<app-name>
            frontend:
              phases:
                preBuild:
                  commands:
                    - npm ci
                build:
                  commands:
                    - npm run build
              artifacts:
                baseDirectory: dist
                files:
                  - '**/*'
              cache:
                paths:
                  - node_modules/**/*
      EnvironmentVariables:
        - Name: AMPLIFY_MONOREPO_APP_ROOT
          Value: apps/<app-name>
        - Name: VITE_ENV
          Value: !Ref Environment
        - Name: VITE_COGNITO_USER_POOL_ID
          Value: !Sub '{{resolve:ssm:/tools/${Environment}/<app-name>/cognito/user-pool-id}}'
        - Name: VITE_COGNITO_CLIENT_ID
          Value: !Sub '{{resolve:ssm:/tools/${Environment}/<app-name>/cognito/client-id}}'
      CustomRules:
        - Source: '</^[^.]+$|\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>'
          Target: /index.html
          Status: '200'
      Tags:
        - Key: Environment
          Value: !Ref Environment
        - Key: Project
          Value: tools-platform

  <AppName>AmplifyBranch:
    Type: AWS::Amplify::Branch
    Properties:
      AppId: !GetAtt <AppName>AmplifyApp.AppId
      BranchName: !If [IsProduction, main, staging]
      EnableAutoBuild: true
      EnablePullRequestPreview: !If [IsStaging, true, false]
      Framework: Vite
      Stage: !If [IsProduction, PRODUCTION, DEVELOPMENT]
```

Add corresponding Outputs:

```yaml
  <AppName>AmplifyAppId:
    Value: !GetAtt <AppName>AmplifyApp.AppId
    Export:
      Name: !Sub 'tools-shared-amplify-${Environment}-<AppName>AppId'
```

---

## Step 5 — Register the App in the Landing Page

Open `apps/landing-page/src/config/apps.js` and add an entry:

```js
export const APPS = [
  // ... existing apps ...
  {
    id: '<app-name>',
    name: 'My New Tool',
    description: 'One-line description shown on the landing page.',
    url: 'https://<app-name>.jtamerius.com',
    subdomain: '<app-name>',
    isPublic: false,         // true = visible to unauthenticated users
    requiredGroup: 'member', // null = any authenticated user; 'admin' = admins only
  },
]
```

The landing page `AppCard` component reads `requiredGroup` and `isPublic` to decide whether to show the card and whether to show a lock icon.

---

## Step 6 — Update GitHub Actions Path Filters

All three workflow files (`ci.yml`, `deploy-staging.yml`, `deploy-production.yml`) use `dorny/paths-filter` to detect changes. Add entries for your new app in the `filters` block of each file:

```yaml
filters: |
  # existing entries...
  <app-name>:
    - 'apps/<app-name>/**'
    - 'shared/**'
  infra-<app-name>:
    - 'infra/apps/<app-name>/**'
```

Then add corresponding jobs that mirror the `lint-and-test-landing-page` and `validate-infra` jobs in `ci.yml`, and the deploy jobs in the staging/production workflows. Use the existing landing-page jobs as templates, replacing `landing-page` with `<app-name>` throughout.

---

## Step 7 — Add GitHub Secrets

The deploy workflows need the Amplify app ID to trigger builds. After the shared amplify stack is deployed (Step 4), find the new app's ID in the AWS Amplify console or from the CloudFormation output:

```bash
aws cloudformation describe-stacks \
  --stack-name tools-shared-amplify-staging \
  --query "Stacks[0].Outputs[?OutputKey=='<AppName>AmplifyAppId'].OutputValue" \
  --output text
```

Add a GitHub Secret named `AMPLIFY_APP_ID_<APP_NAME>` (uppercase, underscores) with this value. Reference it in the deploy workflows:

```yaml
- name: Trigger Amplify deployment
  run: |
    aws amplify start-job \
      --app-id ${{ secrets.AMPLIFY_APP_ID_<APP_NAME> }} \
      --branch-name staging \
      --job-type RELEASE
```

---

## Step 8 — Set Up a Custom Domain

1. In the AWS Amplify console, open your new app.
2. Go to **App settings → Domain management**.
3. Click **Add domain**, enter `jtamerius.com`.
4. Add a subdomain mapping:
   - Subdomain: `<app-name>` (production) or `<app-name>.staging` (staging)
   - Branch: `production` or `staging`
5. Follow the DNS validation steps — Amplify will show the CNAME records to add in Route 53.

If you provisioned the ACM wildcard certificate in `infra/shared/dns/` (`*.jtamerius.com`), Amplify can use it automatically. Select **Use existing certificate** and choose the ACM ARN from the `infra/shared/dns` stack output.

---

## Step 9 — Push to Staging and Verify

```bash
git checkout staging
git add .
git commit -m "feat: add <app-name> app"
git push origin staging
```

Watch the GitHub Actions run. The pipeline should:

1. Detect changes in `infra/shared/amplify/` and `infra/apps/<app-name>/`
2. Deploy (or update) the shared amplify stack
3. Deploy the app infra stack (writes SSM params)
4. Trigger an Amplify build for the new app
5. Poll until the build reports `SUCCEED`

Once deployed, visit `https://<app-name>.staging.jtamerius.com` to confirm the app loads and auth works.

---

## Checklist

- [ ] `apps/<app-name>/` scaffolded with Vite + React
- [ ] `apps/<app-name>/amplify.yml` created
- [ ] `apps/<app-name>/.env.example` created
- [ ] `infra/apps/<app-name>/template.yaml` created
- [ ] New Amplify app added to `infra/shared/amplify/template.yaml`
- [ ] App registered in `apps/landing-page/src/config/apps.js`
- [ ] Path filters updated in `ci.yml`, `deploy-staging.yml`, `deploy-production.yml`
- [ ] `AMPLIFY_APP_ID_<APP_NAME>` GitHub Secret added
- [ ] Custom domain configured in Amplify console
- [ ] Pushed to staging and verified end-to-end

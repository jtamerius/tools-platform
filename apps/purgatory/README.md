# Purgatory Crowding Intelligence

Phase 1.0 (traffic-cam ingest) + Phase 1.1 (resort scrape).

## Layout

```
apps/purgatory/
├── frontend/      React UI — public read-only dashboard + review/annotate tools
├── ingest/        Container Lambda — image fetch + YOLO + RWIS + agent QC
├── scrape/        Python Lambda — Purgatory resort current conditions + forecast
├── api/           Python Lambda — review UI backend (DynamoDB + S3 presign)
└── scripts/       cam_config seed JSON + loader
```

Infrastructure: `infra/cdk/lib/stacks/purgatory-stack.ts`
Registration: `infra/cdk/bin/app.ts`, `shared/config/src/apps.js`

## AWS resources (per env)

| Resource | Name |
|----------|------|
| S3 raw bucket | `tools-purgatory-raw-{env}-606196119553` |
| DynamoDB: ingest records | `tools-purgatory-ingest-{env}` |
| DynamoDB: cam config | `tools-purgatory-cam-config-{env}` |
| DynamoDB: resort conditions | `tools-purgatory-resort-{env}` |
| DynamoDB: agent counter | `tools-purgatory-agent-counter-{env}` |
| ECR: ingest container | `tools-purgatory-ingest-{env}` |
| Lambda: ingest (container) | `tools-purgatory-ingest-{env}` |
| Lambda: scrape | `tools-purgatory-scrape-{env}` |
| Lambda: review API | `tools-purgatory-api-{env}` |
| EventBridge: ingest schedule | `tools-purgatory-ingest-{env}` (rate 15 min) |
| EventBridge: scrape schedule | `tools-purgatory-scrape-{env}` (rate 15 min) |

## SSM parameters

```
/tools/{env}/purgatory/api-url
/tools/{env}/purgatory/raw-bucket
/tools/{env}/purgatory/ingest-table
/tools/{env}/purgatory/cam-config-table
/tools/{env}/purgatory/resort-table
/tools/{env}/purgatory/ingest-ecr-uri
/tools/{env}/purgatory/anthropic-api-key   (SecureString — create manually)
```

## First-time setup (when ready to deploy)

1. Create the SecureString SSM param for Anthropic:
   ```
   aws ssm put-parameter --name /tools/staging/purgatory/anthropic-api-key \
     --type SecureString --value '<key>' --profile jtam --region us-east-1
   ```
2. Build & push the ingest container image to ECR (tag `latest`):
   - The ingest Lambda will fail until at least one image exists. Recommend
     bootstrapping with a CodeBuild project or manual `docker push` before the
     first CDK deploy. (Phase 1.0 step 4 — wire this through GHA.)
3. Bake the YOLO weights into the image: place `yolov8n.pt` next to `Dockerfile`.
4. Seed cam config:
   ```
   AWS_PROFILE=jtam python apps/purgatory/scripts/seed_cam_config.py staging
   ```

## Open work before first deploy

- Wire the ingest Docker build into CI (CodeBuild or GHA → ECR push).
- Resolve Purgatory scrape selectors against the live page (Phase 1.1 step 1).
- Decide on resort scrape strategy if page is client-rendered (Playwright on Lambda).
- Add `AMPLIFY_APP_ID_PURGATORY` to GitHub Actions secrets after Amplify stack creation.
- Draw ROI polygons on sample frames per cam, write to cam config table, bump roi_version.
- Confirm RWIS field key names (`Air Temperature`, etc.) match `apps/purgatory/ingest/src/cotrip.py` once first GraphQL response is captured.

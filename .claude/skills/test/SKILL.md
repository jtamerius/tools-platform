---
name: test
description: Run tests for one or all apps in the monorepo. Pass an app name to test just that app, or omit to test all.
argument-hint: "[landing-page|weather-app|finance-app]"
allowed-tools: Bash(npm *), Bash(cd *)
---

# Run Tests

Parse `$ARGUMENTS` as `[app-name]`:
- If provided: run tests for that specific app
- If omitted: run tests for all apps

```bash
# Single app:
cd /Users/James/website_hub/website_hub/apps/{app-name}
npm run test

# All apps (from monorepo root):
cd /Users/James/website_hub/website_hub
npm run test --workspaces --if-present
```

**Test locations:**
| App | Test directory |
|-----|---------------|
| `landing-page` | `apps/landing-page/src/test/` |
| `weather-app` | `apps/weather-app/src/test/` |
| `finance-app` | `apps/finance-app/src/test/` |

Tests use **Vitest** + **@testing-library/react**. Test files match `*.test.jsx`.

Report:
- Pass/fail count per app
- Any test failures with their error output
- Test coverage if available

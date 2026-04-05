---
name: sso
description: Refresh the AWS SSO token for the jtam profile. Run this when any AWS command fails with "Token has expired" or "SSO token expired".
allowed-tools: Bash(aws sso login *)
---

# Refresh AWS SSO

```bash
aws sso login --profile jtam
```

After login succeeds, retry the command that failed.

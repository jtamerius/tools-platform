#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
zip -j finance_package.zip lambda_handler.py

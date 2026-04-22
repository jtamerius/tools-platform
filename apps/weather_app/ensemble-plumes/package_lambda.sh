#!/usr/bin/env bash
# package_lambda.sh — Package the weather-collector Lambda deployment zip.
#
# Usage:
#   bash apps/weather_app/ensemble-plumes/package_lambda.sh
#
# Output:
#   apps/weather_app/ensemble-plumes/lambda_package.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP_OUT="$SCRIPT_DIR/lambda_package.zip"

echo "Building weather-collector Lambda package..."

cd "$SCRIPT_DIR"
zip -r "$ZIP_OUT" \
    lambda_function.py \
    locations.json \
    clustering/ \
    ingestion/ \
    visualization/ \
    -x "*.pyc" -x "*/__pycache__/*" > /dev/null

echo "Package created: $ZIP_OUT ($(du -sh "$ZIP_OUT" | cut -f1))"

#!/usr/bin/env bash
# package_lambda.sh — Package the news-scraper Lambda deployment zip.
#
# Usage:
#   bash apps/news-scraper/package_lambda.sh
#
# Output:
#   apps/news-scraper/lambda_package.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$(mktemp -d)"
ZIP_OUT="$SCRIPT_DIR/lambda_package.zip"

echo "Building news-scraper Lambda package..."

# Install dependencies into build dir
pip install -r "$SCRIPT_DIR/requirements.txt" \
    --target "$BUILD_DIR" \
    --quiet \
    --upgrade

# Copy scraper source
cp "$SCRIPT_DIR"/*.py "$BUILD_DIR/"

# Remove unnecessary files to keep zip small
find "$BUILD_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR" -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR" -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true

# Create zip
cd "$BUILD_DIR"
zip -r "$ZIP_OUT" . -x "*.pyc" > /dev/null

echo "Package created: $ZIP_OUT ($(du -sh "$ZIP_OUT" | cut -f1))"
rm -rf "$BUILD_DIR"

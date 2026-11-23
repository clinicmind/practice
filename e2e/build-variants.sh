#!/usr/bin/env bash
# Builds the two extra bundles the EFT-stage e2e tests run against, from the REAL course content:
#   dist-real: the normal build (what the live site gets).
#   dist-eft:  the same, with test-only review rows that register EFT module 1, as if the owner had reviewed it.
# Run after the main build. Leaves public/content holding the last of these.
set -euo pipefail

CONTENT_DIR=content npm run content --silent
npx vite build --outDir dist-real --emptyOutDir

rm -rf .e2e-eft
cp -r content .e2e-eft
printf '| eft-attunement | en | 1.0.0 | 2026-01-01 |\n| eft-attunement | zh-Hant | 1.0.0 | 2026-01-01 |\n' >> .e2e-eft/REVIEW.md
CONTENT_DIR=.e2e-eft npm run content --silent
npx vite build --outDir dist-eft --emptyOutDir
rm -rf .e2e-eft

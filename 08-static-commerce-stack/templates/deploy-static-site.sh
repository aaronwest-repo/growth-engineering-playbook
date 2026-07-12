#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy-static-site.sh — ILLUSTRATIVE TEMPLATE (not a real deploy script).
#
# This is a generalized, public-safe example for the Growth Engineering
# Playbook. It is DRY-RUN by default and only ECHOES the commands it would run.
# It contains NO real bucket names, distribution IDs, account IDs, domains, or
# credentials — only placeholders you replace via environment variables.
#
# Fill these in (e.g. in a .env file, see .env.example) before adapting:
#   STATIC_BUCKET_NAME   - your object-storage bucket
#   CDN_DISTRIBUTION_ID  - your CDN distribution
#   BUILD_DIR            - local build output directory
#   SITE_DOMAIN          - your public domain
#
# Nothing here will deploy real infrastructure. Replace the echoed commands
# with your provider's CLI only after reviewing them.
# ---------------------------------------------------------------------------
set -euo pipefail

# --- Configuration (placeholders) ------------------------------------------
STATIC_BUCKET_NAME="${STATIC_BUCKET_NAME:-STATIC_BUCKET_NAME}"
CDN_DISTRIBUTION_ID="${CDN_DISTRIBUTION_ID:-CDN_DISTRIBUTION_ID}"
BUILD_DIR="${BUILD_DIR:-./dist}"
SITE_DOMAIN="${SITE_DOMAIN:-SITE_DOMAIN}"

# DRY_RUN=1 (default) only prints commands. Set DRY_RUN=0 to adapt for real use.
DRY_RUN="${DRY_RUN:-1}"

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] $*"
  else
    echo "[would run] $*   # <- wire up your provider CLI here after review"
  fi
}

echo "== Static site deploy (template / dry-run=$DRY_RUN) =="
echo "   bucket=$STATIC_BUCKET_NAME  distribution=$CDN_DISTRIBUTION_ID"
echo "   build=$BUILD_DIR  domain=$SITE_DOMAIN"

# --- 1. Build --------------------------------------------------------------
echo "-- build --"
run "your-static-site-generator build --out \"$BUILD_DIR\""

# --- 2. Sync to object storage ---------------------------------------------
# Upload changed files; do NOT delete removed files in the same step without a
# reviewed prune plan and a retained previous version for rollback.
echo "-- sync --"
run "object-storage sync \"$BUILD_DIR\" storage://$STATIC_BUCKET_NAME --cache-control from:cache-policy.json"

# --- 3. Invalidate CDN cache -----------------------------------------------
# Prefer invalidating only changed paths. A wildcard (/*) is simple but
# refetches the whole site and costs more; use it deliberately.
echo "-- invalidate --"
CHANGED_PATHS="${CHANGED_PATHS:-/index.html /products.html}"
run "cdn create-invalidation --distribution \"$CDN_DISTRIBUTION_ID\" --paths $CHANGED_PATHS"

# --- 4. Verify -------------------------------------------------------------
# Fetch through the CDN and confirm the new version + working assets/images.
echo "-- verify --"
run "curl -sI https://$SITE_DOMAIN/ | grep -i 'x-cache\\|etag\\|last-modified'"
run "curl -sf https://$SITE_DOMAIN/ > /dev/null && echo 'home OK'"

echo "== Done (template). Nothing real was deployed. =="

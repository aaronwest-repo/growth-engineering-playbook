#!/usr/bin/env bash
# Fails if required skeleton files are missing or if any .env file is committed.
set -euo pipefail

cd "$(dirname "$0")/.."

required=(
  "README.md"
  "CLAUDE.md"
  "LICENSE"
  ".tool-versions"
  "docs/use-case-readme-template.md"
  "shared-data/README.md"
)

status=0

for f in "${required[@]}"; do
  if [[ -f "$f" ]]; then
    echo "ok: $f"
  else
    echo "MISSING: $f"
    status=1
  fi
done

# Reject any .env files anywhere in the tree (env examples are fine).
if find . -type d -name node_modules -prune -o -type f \
     \( -name ".env" -o -name ".env.*" \) ! -name "*.example" -print | grep -q .; then
  echo "ERROR: .env file(s) present:"
  find . -type d -name node_modules -prune -o -type f \
    \( -name ".env" -o -name ".env.*" \) ! -name "*.example" -print
  status=1
else
  echo "ok: no .env files present"
fi

if [[ $status -eq 0 ]]; then
  echo "Skeleton check passed."
else
  echo "Skeleton check FAILED."
fi

exit $status

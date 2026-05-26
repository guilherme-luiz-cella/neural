#!/usr/bin/env bash
# Sets all 5 production secrets for neural-network-crawler.
# Run from the backend-crawler/ directory.
#
# Usage:
#   bash scripts/set-secrets.sh
#
# Prompts for each value (silent input — no echo). Paste the same values
# you set on the main backend worker. Look them up in the Cloudflare
# dashboard: Workers & Pages -> neural-network-backend-production
#   -> Settings -> Variables and Secrets.
#
# SUPABASE_URL and GOOGLE_CLIENT_ID are not strictly secret but kept here
# for one-shot setup.

set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:-production}"
SECRETS=(SUPABASE_URL SUPABASE_SERVICE_KEY JWT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET)

for name in "${SECRETS[@]}"; do
  printf "Enter value for %s: " "$name"
  read -rs value
  printf "\n"
  if [[ -z "$value" ]]; then
    echo "  (skipped — empty input)"
    continue
  fi
  printf "%s" "$value" | npx wrangler secret put "$name" --env "$ENV" >/dev/null
  echo "  set $name"
done

echo
echo "Done. Verify with: npx wrangler secret list --env $ENV"

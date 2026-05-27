#!/usr/bin/env bash
# Deploys everything for the neural-network project.
#
# Stack:
#   - CF Worker: backend (API gateway)
#   - Supabase Edge Function: crawl-batch, search (auto-deployed via MCP /
#     supabase CLI, not via this script)
#   - Cloudflare Pages: frontend (auto-builds on git push)
#
# Usage:
#   bash scripts/deploy.sh                  # backend deploy + git push
#   bash scripts/deploy.sh --skip-push      # backend only, no git
#   bash scripts/deploy.sh --secrets        # push secrets from backend/.env to backend worker
#   bash scripts/deploy.sh --dry-run        # bundle but don't upload
#
# Prereqs:
#   - wrangler authenticated  (npx wrangler whoami)
#   - backend/.env contains real secrets (when using --secrets)
#   - git push permission to neural/main

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
ENV_FILE="$BACKEND/.env"

SKIP_PUSH=0
DRY_RUN=0
DO_SECRETS=0

for arg in "$@"; do
  case "$arg" in
    --skip-push)    SKIP_PUSH=1 ;;
    --dry-run)      DRY_RUN=1 ;;
    --secrets)      DO_SECRETS=1 ;;
    -h|--help)      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

log() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok()  { printf "    \033[1;32m✓\033[0m %s\n" "$*"; }
warn(){ printf "    \033[1;33m!\033[0m %s\n" "$*"; }

push_secrets() {
  if [[ ! -f "$ENV_FILE" ]]; then
    warn "$ENV_FILE not found — skipping secrets"
    return
  fi
  log "push secrets → neural-network-backend"
  for k in SUPABASE_URL SUPABASE_SERVICE_KEY JWT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
    local value
    value="$(grep "^$k=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
    if [[ -z "$value" || "$value" == "PASTE_HERE" || "$value" == "change-this-to-a-long-random-secret" ]]; then
      warn "skip $k (empty or placeholder in .env)"
      continue
    fi
    (cd "$BACKEND" && printf "%s" "$value" | npx wrangler secret put "$k" --env production >/dev/null 2>&1)
    ok "$k"
  done
}

deploy_backend() {
  log "deploy neural-network-backend"
  cd "$BACKEND"
  if [[ $DRY_RUN -eq 1 ]]; then
    npx wrangler deploy --env production --dry-run --outdir ".dryrun" 2>&1 | tail -5
    rm -rf ".dryrun"
  else
    npx wrangler deploy --env production 2>&1 | tail -6
  fi
  ok "backend deployed"
  cd - >/dev/null
}

log "preflight"
if ! (cd "$BACKEND" && npx wrangler whoami >/dev/null 2>&1); then
  echo "wrangler not authenticated. run: npx wrangler login" >&2
  exit 1
fi
ok "wrangler authenticated"

[[ $DO_SECRETS -eq 1 ]] && push_secrets

deploy_backend

if [[ $SKIP_PUSH -eq 0 && $DRY_RUN -eq 0 ]]; then
  log "git push (triggers Pages build)"
  cd "$ROOT"
  if git diff --quiet && git diff --cached --quiet; then
    if git log neural/main..HEAD --oneline 2>/dev/null | grep -q .; then
      git push neural main && ok "pushed"
    else
      ok "no commits ahead of neural/main"
    fi
  else
    warn "uncommitted changes — skipping push. Commit first, then re-run."
  fi
fi

log "done"

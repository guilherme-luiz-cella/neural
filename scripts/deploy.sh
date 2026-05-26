#!/usr/bin/env bash
# Deploys everything for the neural-network project.
#
# Default: deploy both Workers (backend + backend-crawler) to production and
# push to neural/main so Cloudflare Pages rebuilds the frontend.
#
# Usage:
#   bash scripts/deploy.sh                  # full deploy (workers + git push)
#   bash scripts/deploy.sh --skip-push      # workers only, no git
#   bash scripts/deploy.sh --skip-crawler   # main backend only
#   bash scripts/deploy.sh --skip-backend   # crawler only
#   bash scripts/deploy.sh --secrets        # push secrets from backend/.env to both workers
#   bash scripts/deploy.sh --dry-run        # bundle but don't upload
#
# Prereqs:
#   - wrangler authenticated  (npx wrangler whoami)
#   - backend/.env contains real SUPABASE_URL, SUPABASE_SERVICE_KEY,
#     JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (when using --secrets)
#   - git push permission to neural/main

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
CRAWLER="$ROOT/backend-crawler"
ENV_FILE="$BACKEND/.env"

SKIP_BACKEND=0
SKIP_CRAWLER=0
SKIP_PUSH=0
DRY_RUN=0
DO_SECRETS=0

for arg in "$@"; do
  case "$arg" in
    --skip-backend) SKIP_BACKEND=1 ;;
    --skip-crawler) SKIP_CRAWLER=1 ;;
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
  local target_dir="$1"
  local target_name="$2"
  if [[ ! -f "$ENV_FILE" ]]; then
    warn "$ENV_FILE not found — skipping secrets for $target_name"
    return
  fi
  log "push secrets → $target_name"
  for k in SUPABASE_URL SUPABASE_SERVICE_KEY JWT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
    local value
    value="$(grep "^$k=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
    if [[ -z "$value" || "$value" == "PASTE_HERE" || "$value" == "change-this-to-a-long-random-secret" ]]; then
      warn "skip $k (empty or placeholder in .env)"
      continue
    fi
    (cd "$target_dir" && printf "%s" "$value" | npx wrangler secret put "$k" --env production >/dev/null 2>&1)
    ok "$k"
  done
}

deploy_worker() {
  local dir="$1"
  local name="$2"
  log "deploy $name"
  cd "$dir"
  if [[ $DRY_RUN -eq 1 ]]; then
    npx wrangler deploy --env production --dry-run --outdir ".dryrun" 2>&1 | tail -5
    rm -rf ".dryrun"
  else
    npx wrangler deploy --env production 2>&1 | tail -6
  fi
  ok "$name deployed"
  cd - >/dev/null
}

log "preflight"
if ! npx --prefix "$BACKEND" wrangler whoami >/dev/null 2>&1; then
  echo "wrangler not authenticated. run: npx wrangler login" >&2
  exit 1
fi
ok "wrangler authenticated"

if [[ $DO_SECRETS -eq 1 ]]; then
  [[ $SKIP_BACKEND -eq 0 ]] && push_secrets "$BACKEND" "neural-network-backend"
  [[ $SKIP_CRAWLER -eq 0 ]] && push_secrets "$CRAWLER" "neural-network-crawler"
fi

[[ $SKIP_BACKEND -eq 0 ]] && deploy_worker "$BACKEND" "neural-network-backend"
[[ $SKIP_CRAWLER -eq 0 ]] && deploy_worker "$CRAWLER" "neural-network-crawler"

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

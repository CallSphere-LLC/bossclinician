#!/usr/bin/env bash
# Rolls one CI-tested commit out to production, proves the live site serves it,
# and puts the previous release back if it does not.
#
# Run by .github/workflows/deploy.yml on the production host's own runner, from
# a checkout of the pipeline's commit; it deploys into DEPLOY_DIR. Not meant for
# hand use (./scripts/deploy.sh is the manual path), but safe if it is: every
# refusal happens before anything on the server moves.
#
#   TARGET_SHA=<sha> EVENT_NAME=push|workflow_dispatch scripts/ci/deploy-release.sh
#
# Exit status
#   0  deployed and verified, verified only, or skipped as superseded
#   3  refused; nothing was touched
#   1  failed; if anything had moved, the previous release was put back
#
# The order of operations is the design. See docs/CI-CD.md for the reasoning
# and scripts/ci/tests/test_deploy_release.py for every path through it.
set -euo pipefail
set -E

TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${TARGET_SHA:?TARGET_SHA is required}"
EVENT_NAME="${EVENT_NAME:-workflow_dispatch}"
FORCE_REBUILD="${FORCE_REBUILD:-false}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/bossclinician}"
SITE_URL="${SITE_URL:-https://bossclinician.callsphere.site}"
ADMIN_URL="${ADMIN_URL:-https://admin.bossclinician.callsphere.site}"
LOCK_DIR="${LOCK_DIR:-/run/lock/callsphere}"
MIN_FREE_GB="${MIN_FREE_GB:-10}"
GATE_ATTEMPTS="${GATE_ATTEMPTS:-12}"
GATE_INTERVAL="${GATE_INTERVAL:-10}"
DEPLOY_SH="${DEPLOY_SH:-$TOOLS/scripts/deploy.sh}"
SMOKE_TEST="${SMOKE_TEST:-$TOOLS/scripts/smoke-test.sh}"
PRUNE_CMD="${PRUNE_CMD:-/usr/local/sbin/callsphere-image-prune}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

DEPLOY_DIR="$(cd "$DEPLOY_DIR" && pwd)"
STATE_DIR="$DEPLOY_DIR/.git/bossclinician-deploy"
# Compose names images <project>-<service>, and the project is the directory.
PROJECT="$(basename "$DEPLOY_DIR")"

log() { printf '\n==> %s\n' "$*"; }
summary() { printf '%s\n' "$@" >>"$SUMMARY"; }
short() { printf '%s' "${1:0:12}"; }

cd "$DEPLOY_DIR"
mkdir -p "$STATE_DIR" "$LOCK_DIR"

decision="$(mktemp)"
live_map="$(mktemp)"
trap 'rm -f "$decision" "$live_map"' EXIT

# ---------------------------------------------------------------------------
# 1. Decide. Read-only: a refusal leaves the server exactly as it was.
# ---------------------------------------------------------------------------
log "Deciding whether $(short "$TARGET_SHA") may go to production"
check_args=(check --repo "$DEPLOY_DIR" --target "$TARGET_SHA" --event "$EVENT_NAME"
  --state-dir "$STATE_DIR" --min-free-gb "$MIN_FREE_GB")
[ "$FORCE_REBUILD" = "true" ] && check_args+=(--force-rebuild)

rc=0
python3 "$TOOLS/scripts/ci/release.py" "${check_args[@]}" >"$decision" || rc=$?
if [ "$rc" -ne 0 ]; then
  summary "### 🛑 Deploy refused" "Nothing on the server was changed. The reason is in the job log."
  exit "$rc"
fi

ACTION="" REASON="" HEAD="" TARGET="" SERVICES="" COMPOSE_CHANGED="" NGINX_CHANGED=""
K8S_CHANGED="" MIGRATIONS_CHANGED="" ROLLBACK=""
# shellcheck source=/dev/null
. "$decision"
echo "$REASON"
# Only the fetch above needed it. Builds and containers started below inherit
# this environment, and have no business holding a GitHub token.
unset GIT_FETCH_TOKEN

summary "### Production deploy" "" \
  "| | |" "|---|---|" \
  "| Live before | \`$(short "$HEAD")\` |" \
  "| Requested | \`$(short "$TARGET")\` ($EVENT_NAME) |" \
  "| Decision | **$ACTION** — $REASON |" \
  "| Rebuilds | ${SERVICES:-nothing} |" \
  "| nginx config / migrations / k8s | $NGINX_CHANGED / $MIGRATIONS_CHANGED / $K8S_CHANGED |" ""

[ "$ACTION" = "skip" ] && exit 0

# ---------------------------------------------------------------------------
# Helpers for the steps that change things.
# ---------------------------------------------------------------------------
nginx_reload() {
  # -t first: a config nginx rejects must never reach a reload. A reload also
  # re-resolves `backend` and `frontend`, which a recreated container may have
  # moved to a new address.
  docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload
}

gate_once() {
  local expected="$1" body release
  if ! body="$(curl -fsS --max-time 15 "$SITE_URL/api/health")"; then
    echo "  $SITE_URL/api/health did not answer 200"
    return 1
  fi
  if [ -n "$expected" ]; then
    release="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("release", ""))' 2>/dev/null || true)"
    if [ "$release" != "$expected" ]; then
      echo "  the live API reports release '${release:-none}', expected $(short "$expected")"
      return 1
    fi
  fi
  SMOKE_SKIP_HOST_CHECKS=1 SMOKE_ADMIN_BASE="$ADMIN_URL" DEPLOY_DIR="$DEPLOY_DIR" "$SMOKE_TEST" "$SITE_URL"
}

# Through the public URL, so it proves the whole path a visitor takes: DNS,
# Traefik, the k3s route to this stack, nginx and the containers behind it.
gate() {
  local expected="$1" attempt
  for attempt in $(seq 1 "$GATE_ATTEMPTS"); do
    if gate_once "$expected"; then
      return 0
    fi
    if [ "$attempt" -lt "$GATE_ATTEMPTS" ]; then
      echo "  gate attempt $attempt/$GATE_ATTEMPTS failed; retrying in ${GATE_INTERVAL}s"
      sleep "$GATE_INTERVAL"
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# 2. Already live: verify only.
# ---------------------------------------------------------------------------
if [ "$ACTION" = "verify" ]; then
  log "Nothing to roll out; checking the live site"
  if gate ""; then
    summary "✅ \`$(short "$TARGET")\` is live and passed the health gate."
    exit 0
  fi
  echo "::error::$(short "$TARGET") is live but fails the health gate. Nothing was rolled back: this commit is what is deployed."
  summary "❌ \`$(short "$TARGET")\` is live but fails the health gate."
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Deploy.
# ---------------------------------------------------------------------------
UP_SERVICES=()
if [ "$COMPOSE_CHANGED" != "true" ]; then
  read -r -a UP_SERVICES <<<"$SERVICES"
fi
ROLLBACK_TAGGED=()
BUILT=false

rollback() {
  trap - ERR
  set +e
  local why="$1" svc restored=true
  echo "::error::$why. Rolling back to $(short "$HEAD")."
  summary "### ❌ $why" "Rolling back to \`$(short "$HEAD")\`."

  git checkout -q -f -B main "$HEAD"
  [ -s "$live_map" ] && cat "$live_map" >nginx/redirects.map

  for svc in "${ROLLBACK_TAGGED[@]}"; do
    docker tag "$PROJECT-$svc:rollback" "$PROJECT-$svc:latest"
  done
  if [ "$BUILT" = "true" ]; then
    docker compose up -d --wait --no-build "${UP_SERVICES[@]}" || restored=false
  fi
  nginx_reload || restored=false

  if [ "$restored" = "true" ] && gate ""; then
    summary "The previous release is serving again and passed the health gate."
    if [ "$MIGRATIONS_CHANGED" = "true" ]; then
      summary "Migrations the failed release applied are still in the database."
    fi
  else
    echo "::error::THE ROLLBACK DID NOT RESTORE A HEALTHY SITE. Follow docs/CI-CD.md, 'When a rollback fails'."
    summary "**The rollback did not restore a healthy site. Follow docs/CI-CD.md → When a rollback fails.**"
  fi
  exit 1
}

# Hold the host's image-retention lock from the moment the running images are
# tagged for rollback until the new release has passed its gate. Another app's
# post-deploy prune skips while it is held, instead of deleting the very images
# a rollback here would need.
exec 8<"$LOCK_DIR"
if ! flock -w 900 8; then
  echo "::error::the shared image-retention lock stayed busy for 15 minutes; nothing was changed."
  exit 1
fi

[ -f nginx/redirects.map ] && cp nginx/redirects.map "$live_map"

for svc in $SERVICES; do
  cid="$(docker compose ps -q "$svc" 2>/dev/null | head -n1 || true)"
  [ -n "$cid" ] || continue
  docker tag "$(docker inspect --format '{{.Image}}' "$cid")" "$PROJECT-$svc:rollback"
  ROLLBACK_TAGGED+=("$svc")
done

# From here on the server moves, so any unexpected failure rolls back.
trap 'rollback "Unexpected failure at deploy-release.sh line $LINENO"' ERR

log "Checking out $(short "$TARGET")"
# The generated map is the only tracked file allowed to differ; the live copy
# was saved above and the database is regenerated into it below.
git checkout -q -- nginx/redirects.map 2>/dev/null || true
git checkout -q -B main "$TARGET"
git branch -q --set-upstream-to=origin/main main 2>/dev/null || true

if [ -n "$SERVICES" ]; then
  if [ "$COMPOSE_CHANGED" = "true" ]; then
    log "docker-compose.yml changed: building and reconciling every service"
  else
    log "Building and restarting: $SERVICES"
  fi
  BUILT=true
  if ! DEPLOY_DIR="$DEPLOY_DIR" LOCK_DIR="$LOCK_DIR" SKIP_PRUNE=1 APP_RELEASE="$TARGET" \
    "$DEPLOY_SH" "${UP_SERVICES[@]}"; then
    rollback "Build or startup failed"
  fi
else
  log "No image changes; nothing to rebuild"
fi

log "Validating and reloading nginx"
nginx_reload || rollback "nginx rejected the configuration"

log "Regenerating nginx/redirects.map from the redirects table"
fresh="$(mktemp)"
if docker compose exec -T backend node scripts/generate-nginx-redirects.js /tmp/redirects.map >/dev/null \
  && docker compose cp backend:/tmp/redirects.map "$fresh" >/dev/null; then
  # The header carries a row count that changes without any redirect changing.
  if ! cmp -s <(grep -v '^#' "$fresh") <(grep -v '^#' nginx/redirects.map 2>/dev/null); then
    cat "$fresh" >nginx/redirects.map
    echo "redirects changed; reloading nginx"
    nginx_reload || rollback "nginx rejected the regenerated redirects.map"
  else
    echo "redirects unchanged"
  fi
else
  echo "::warning::could not regenerate nginx/redirects.map from the database; serving the committed map"
fi
rm -f "$fresh"

log "Health gate"
expected_release=""
case " $SERVICES " in *" backend "*) expected_release="$TARGET" ;; esac
gate "$expected_release" || rollback "The new release failed the health gate"

trap - ERR
echo "$TARGET" >"$STATE_DIR/last-deployed"
printf '%s %s -> %s [%s]\n' "$(date -u +%FT%TZ)" "$HEAD" "$TARGET" "${SERVICES:-no rebuild}" >>"$STATE_DIR/history"
flock -u 8
exec 8<&-
summary "### ✅ Live: \`$(short "$TARGET")\`"
[ "$ROLLBACK" = "true" ] && summary "This deploy rolled production back to an older commit."

if [ "$BUILT" = "true" ]; then
  # Only now: until the gate passed, the superseded images were the rollback.
  sudo -n "$PRUNE_CMD" reclaim --post-deploy \
    || echo "::warning::image retention failed; the deployment itself is healthy"
fi

if [ "$K8S_CHANGED" = "true" ]; then
  log "k8s/ changed. Differences from the live cluster (NOT applied):"
  sudo -n k3s kubectl diff -f k8s/ || true
fi

log "Full smoke test, including database, job queue and TURN relay"
if ! DEPLOY_DIR="$DEPLOY_DIR" SMOKE_ADMIN_BASE="$ADMIN_URL" "$SMOKE_TEST" "$SITE_URL"; then
  echo "::error::$(short "$TARGET") is live and passed the gate, but the host checks failed. Not rolled back: a stale dead letter or a relay problem is not proof this release is at fault. Investigate."
  summary "⚠️ Host checks failed after the release went live (not rolled back)."
  exit 1
fi

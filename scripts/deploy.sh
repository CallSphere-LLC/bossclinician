#!/usr/bin/env bash
# Build, roll out, verify, then reclaim only unused container artifacts.
#
# Production normally deploys through GitHub Actions (docs/CI-CD.md), which
# calls this script. Running it by hand still works and is the break-glass path.
#
#   ./scripts/deploy.sh [service...]
#
# DEPLOY_DIR   checkout to deploy (default: the one this script lives in)
# APP_RELEASE  commit reported by /api/health (default: that checkout's HEAD)
# SKIP_PRUNE=1 leave superseded images in place (the pipeline prunes only after
#              its health gate passes, so a rollback still has them)
set -euo pipefail
cd "${DEPLOY_DIR:-$(dirname "$0")/..}"

# This host runs multiple production apps. Keep their image builds serialized
# so BuildKit cannot force live services into memory pressure. /run is a tmpfs,
# so the lock directory does not survive a reboot.
LOCK_DIR="${LOCK_DIR:-/run/lock/callsphere}"
mkdir -p "$LOCK_DIR"
exec 9>"$LOCK_DIR/build.lock"
flock -w 1800 9 || {
  echo "another build holds the shared build lock after 30m" >&2
  exit 1
}

# Build on the daemon's own builder. The GitHub Actions runner on this host
# (setup-buildx-action) switches the user's *current* buildx builder to a
# throwaway container and removes it when its job ends, which killed a deploy
# mid-build ("graceful_stop") on 2026-09-11. An explicit builder is immune.
export BUILDX_BUILDER="${BUILDX_BUILDER:-default}"

if [ -z "${APP_RELEASE:-}" ]; then
  APP_RELEASE="$(git rev-parse HEAD 2>/dev/null || echo dev)"
  # nginx/redirects.map is regenerated from the database in place; it is not a
  # code change.
  if [ -n "$(git status --porcelain --untracked-files=no -- . ':!nginx/redirects.map' 2>/dev/null)" ]; then
    APP_RELEASE="$APP_RELEASE-dirty"
  fi
fi
export APP_RELEASE

COMPOSE_PARALLEL_LIMIT=1 docker compose build "$@"
docker compose up -d --wait "$@"

if [ "${SKIP_PRUNE:-0}" = "1" ]; then
  echo "deployment healthy; pruning left to the caller"
  exit 0
fi

# Docker retains every image referenced by an existing container. The shared
# helper also protects Kubernetes workloads/CronJobs and rollback images; it
# never prunes volumes, networks or database data.
sudo -n /usr/local/sbin/callsphere-image-prune reclaim --post-deploy \
  || echo "WARN: image retention failed; deployment remains healthy" >&2

echo "deployment healthy; obsolete image/build residue retired"

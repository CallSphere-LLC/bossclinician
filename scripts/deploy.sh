#!/usr/bin/env bash
# Build, roll out, verify, then reclaim only unused container artifacts.
set -euo pipefail
cd "$(dirname "$0")/.."

# This host runs multiple production apps. Keep their image builds serialized
# so BuildKit cannot force live services into memory pressure.
exec 9>/run/lock/callsphere/build.lock
flock -w 1800 9 || {
  echo "another build holds the shared build lock after 30m" >&2
  exit 1
}

# Build on the daemon's own builder. The GitHub Actions runner on this host
# (setup-buildx-action) switches the user's *current* buildx builder to a
# throwaway container and removes it when its job ends, which killed a deploy
# mid-build ("graceful_stop") on 2026-09-11. An explicit builder is immune.
export BUILDX_BUILDER="${BUILDX_BUILDER:-default}"

COMPOSE_PARALLEL_LIMIT=1 docker compose build "$@"
docker compose up -d --wait "$@"

# Docker retains every image referenced by an existing container. The shared
# helper also protects Kubernetes workloads/CronJobs and rollback images; it
# never prunes volumes, networks or database data.
sudo -n /usr/local/sbin/callsphere-image-prune reclaim --post-deploy \
  || echo "WARN: image retention failed; deployment remains healthy" >&2

echo "deployment healthy; obsolete image/build residue retired"

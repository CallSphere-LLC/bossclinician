#!/usr/bin/env bash
# Runs the database-backed test suites.
#
# The compose Postgres does not publish a host port (deliberately — the healthcare
# app next door owns 5432), so the tests run inside a throwaway container on the
# compose network rather than from the host. Each suite creates its own scratch
# database from schema.sql plus every migration, and drops it afterwards; the
# application database is never touched.
#
#   ./scripts/test-integration.sh                  # every *.integration.test.ts
#   ./scripts/test-integration.sh src/services/access.integration.test.ts
#
# COMPOSE_PROJECT_NAME picks the stack to run against, as it does for docker
# compose itself; unset, that is the production project, `bossclinician`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NETWORK="${COMPOSE_PROJECT_NAME:-bossclinician}_default"

# By file name, not test name, the way CI selects them: a DB-backed suite whose
# describe() forgets the word "integration" still runs.
if [[ $# -eq 0 ]]; then
  set -- integration.test
fi

DB_PASSWORD="$(grep '^DB_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)"
if [[ -z "$DB_PASSWORD" ]]; then
  echo "DB_PASSWORD not found in $ROOT/.env" >&2
  exit 1
fi

# The project's own vitest, installed inside the container from package-lock.json.
# `npx vitest` found no node_modules in the mount and fetched whatever vitest was
# newest on npm, which is a different major with different CLI flags. The
# anonymous volume over node_modules keeps that install out of the host checkout
# in both directions: nothing written back to it, and no host-built native
# modules (glibc, not this image's musl) loaded from it.
#
# The volume needs a mount point in the checkout. Made here, as you, because
# Docker would otherwise create it as root, and a later `npm ci` on the host
# cannot write into a root-owned node_modules.
mkdir -p "$ROOT/backend/node_modules"
#
# Connects to `postgres` rather than the app database: the harness needs to issue
# CREATE DATABASE, which cannot run inside the database being created. One fork,
# as the CI integration step does.
exec docker run --rm \
  --network "$NETWORK" \
  -v "$ROOT/backend:/app" \
  -v /app/node_modules \
  -w /app \
  -e TEST_DATABASE_URL="postgres://boss:${DB_PASSWORD}@db:5432/postgres" \
  -e JWT_SECRET=integration-test-secret \
  -e NODE_ENV=test \
  -e SMTP_HOST= \
  -e SMTP_USER= \
  -e SMTP_PASS= \
  -e NOTIFY_EMAIL= \
  -e RESEND_API_KEY= \
  -e SES_CONFIG_SET_TRANSACTIONAL= \
  -e SES_CONFIG_SET_MARKETING= \
  -e WORKER_ENABLED=false \
  node:24-alpine \
  sh -c 'npm ci --no-audit --no-fund --loglevel=error \
    && exec node_modules/.bin/vitest run --maxWorkers=1 "$@"' \
  vitest "$@"

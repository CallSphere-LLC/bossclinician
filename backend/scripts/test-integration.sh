#!/usr/bin/env bash
# Runs the database-backed test suites.
#
# The compose Postgres does not publish a host port (deliberately — the healthcare
# app next door owns 5432), so the tests run inside a throwaway container on the
# compose network rather than from the host. Each suite creates its own scratch
# database from schema.sql plus every migration, and drops it afterwards; the
# application database is never touched.
#
#   ./scripts/test-integration.sh                  # all *.integration.test.ts
#   ./scripts/test-integration.sh src/services/access.integration.test.ts
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-}"

DB_PASSWORD="$(grep '^DB_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)"
if [[ -z "$DB_PASSWORD" ]]; then
  echo "DB_PASSWORD not found in $ROOT/.env" >&2
  exit 1
fi

# Connects to `postgres` rather than the app database: the harness needs to issue
# CREATE DATABASE, which cannot run inside the database being created.
exec docker run --rm \
  --network bossclinician_default \
  -v "$ROOT/backend:/app" \
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
  node:20-alpine \
  npx vitest run --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=1 \
    ${TARGET:-"--testNamePattern=integration"}

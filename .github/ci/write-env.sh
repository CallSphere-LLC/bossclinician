#!/usr/bin/env bash
# Throwaway configuration for booting the production images in CI.
#
# Nothing here is a real secret and nothing here reaches production: the server
# keeps its own gitignored .env files, and they never leave it.
#
# Refuses to run anywhere but GitHub Actions, and refuses to overwrite a file
# that already exists. Run by mistake in the production checkout, it would
# otherwise replace the live database password and JWT secret.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "write-env.sh only runs inside GitHub Actions; refusing to touch .env files here." >&2
  exit 1
fi

set -o noclobber

cat > .env <<'EOF'
DB_PASSWORD=ci-db-password
VITE_STRIPE_PUBLISHABLE_KEY=
TURN_HOST=127.0.0.1
TURN_PORT=3479
TURN_STATIC_AUTH_SECRET=ci-turn-secret
EOF

# APP_ENV=staging turns on the backend's send guard, so a CI boot can never
# email anyone outside the test allowlist. SMTP is blank anyway.
cat > backend/.env <<'EOF'
NODE_ENV=production
APP_ENV=staging
JWT_SECRET=ci-jwt-secret-used-nowhere-else
ADMIN_EMAIL=ci-admin@example.com
ADMIN_PASSWORD=ci-admin-password-2026
PUBLIC_SITE_URL=http://localhost:8088
FRONTEND_ORIGIN=http://localhost:8088
SMTP_HOST=
STRIPE_SECRET_KEY=
EOF

# No OpenAI key: the AI service answers from its fallback paths.
cat > ai/.env <<'EOF'
OPENAI_API_KEY=
EOF

echo "wrote throwaway .env, backend/.env and ai/.env for CI"

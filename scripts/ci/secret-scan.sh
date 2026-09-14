#!/usr/bin/env bash
# Fails when the tracked tree holds something shaped like a live credential, or
# a real .env file. The server's .env files are the only home for secrets; once
# a key reaches a commit it is in GitHub's history for good, and the fix is to
# rotate it, not to delete the line.
#
#   scripts/ci/secret-scan.sh [repo-dir]
set -euo pipefail
cd "${1:-.}"

# AWS access key (the SES SMTP user is one), OpenAI/Anthropic keys, Stripe live
# secret/restricted keys and webhook secrets, GitHub tokens, Slack tokens, and
# private keys. Test-mode Stripe keys and publishable keys are not secrets.
PATTERNS='AKIA[0-9A-Z]{16}|sk-(ant-|proj-)[A-Za-z0-9_-]{20,}|sk_live_[0-9A-Za-z]{16,}|rk_live_[0-9A-Za-z]{16,}|whsec_[0-9A-Za-z]{24,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'

status=0

if git grep -nIE "$PATTERNS" -- ':!*package-lock.json'; then
  echo "::error::Something shaped like a live credential is committed (above). Rotate it, then remove it."
  status=1
fi

tracked_env=$(git ls-files | grep -E '(^|/)\.env(\.[^/]*)?$' | grep -vE '\.env\.example$' || true)
if [ -n "$tracked_env" ]; then
  echo "::error::.env files are tracked: $(echo "$tracked_env" | tr '\n' ' ')— secrets live only on the server."
  status=1
fi

[ "$status" -eq 0 ] && echo "secret scan: clean"
exit "$status"

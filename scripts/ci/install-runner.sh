#!/usr/bin/env bash
# One-time setup, by hand, on the production host: installs this repository's
# GitHub Actions runner as a systemd service and wires in the job guard.
#
#   RUNNER_TOKEN=<token> scripts/ci/install-runner.sh
#
# The token comes from GitHub: repository Settings → Actions → Runners →
# New self-hosted runner (Linux). It is valid for one hour and only registers.
#
# Safe to re-run with a fresh token: it re-registers the same runner in place.
# Separate from /opt/actions-runner-callsphere, which belongs to another
# repository; a runner serves exactly one repository.
set -euo pipefail

: "${RUNNER_TOKEN:?set RUNNER_TOKEN (Settings → Actions → Runners → New self-hosted runner)}"
REPO_URL="${REPO_URL:-https://github.com/CallSphere-LLC/bossclinician}"
RUNNER_DIR="${RUNNER_DIR:-/opt/actions-runner-bossclinician}"
RUNNER_VERSION="${RUNNER_VERSION:-2.337.0}"
RUNNER_NAME="${RUNNER_NAME:-bossclinician-$(hostname -s)}"
RUNNER_USER="${RUNNER_USER:-$(id -un)}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

sudo install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -x ./config.sh ]; then
  tarball="actions-runner-linux-x64-$RUNNER_VERSION.tar.gz"
  echo "Downloading runner $RUNNER_VERSION"
  curl -fsSLo "$tarball" "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/$tarball"
  # The release notes carry the checksum; refuse a tarball that does not match.
  expected=$(curl -fsSL "https://api.github.com/repos/actions/runner/releases/tags/v$RUNNER_VERSION" \
    | python3 -c 'import json,re,sys; m=re.search(r"BEGIN SHA linux-x64 -->([0-9a-f]{64})<", json.load(sys.stdin)["body"]); print(m.group(1) if m else "")')
  actual=$(sha256sum "$tarball" | cut -d' ' -f1)
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "runner tarball checksum mismatch (expected '${expected:-none}', got $actual)" >&2
    rm -f "$tarball"
    exit 1
  fi
  tar xzf "$tarball"
  rm -f "$tarball"
fi

# The guard runs before every job and admits only deploy.yml on main. A
# root-owned copy outside the repository, so no commit can loosen it.
sudo install -d -o root -g root -m 755 "$RUNNER_DIR/hooks"
sudo install -o root -g root -m 755 "$SRC/runner-job-guard.sh" "$RUNNER_DIR/hooks/job-started.sh"

if [ -f .service ]; then
  # The systemd unit is named after the repository it was registered for.
  # Remove it so the unit installed below carries the current owner/name.
  sudo ./svc.sh stop || true
  sudo ./svc.sh uninstall || true
fi
if [ -f .runner ]; then
  # Forget the old local registration; --replace below takes over the name.
  rm -f .runner .credentials .credentials_rsaparams
fi

./config.sh --unattended --url "$REPO_URL" --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" --labels bossclinician --work _work --replace

touch .env
if ! grep -q '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' .env; then
  echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=$RUNNER_DIR/hooks/job-started.sh" >>.env
fi

sudo ./svc.sh install "$RUNNER_USER"
sudo ./svc.sh start
sudo ./svc.sh status --no-pager | head -n 5
echo "Runner '$RUNNER_NAME' registered for $REPO_URL with label 'bossclinician'."

#!/usr/bin/env bash
# Production deployments are local K3s releases. Git pushes run checks only.
set -euo pipefail
exec "$(dirname "$0")/deploy-k3s.sh" "$@"

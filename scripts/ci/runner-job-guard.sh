#!/usr/bin/env bash
# Job-started hook for the production runner. It decides which jobs may run on
# the production host at all.
#
# The runner has the deploy user's docker and sudo rights, and a workflow file
# lives on whatever branch pushed it. Without this hook, anyone able to push any
# branch could add a workflow with `runs-on: [self-hosted, bossclinician]` and
# run anything on the server. The check below admits exactly one thing: the
# deploy workflow as it exists on main, for a push to main or a manual dispatch.
#
# Installed as a copy OUTSIDE the repository, and wired up through
# ACTIONS_RUNNER_HOOK_JOB_STARTED in the runner's .env (see docs/CI-CD.md).
# A commit cannot loosen the rule it is judged by.
set -euo pipefail

EXPECTED_REPOSITORY="${GUARD_EXPECTED_REPOSITORY:-shankasf/bossclinician}"
EXPECTED_WORKFLOW="$EXPECTED_REPOSITORY/.github/workflows/deploy.yml@refs/heads/main"

refuse() {
  echo "::error::The production runner refused this job: $*" >&2
  exit 1
}

[ "${GITHUB_REPOSITORY:-}" = "$EXPECTED_REPOSITORY" ] \
  || refuse "repository '${GITHUB_REPOSITORY:-unset}' is not $EXPECTED_REPOSITORY"

[ "${GITHUB_REF:-}" = "refs/heads/main" ] \
  || refuse "ref '${GITHUB_REF:-unset}' is not refs/heads/main"

case "${GITHUB_EVENT_NAME:-}" in
  push | workflow_dispatch) ;;
  *) refuse "event '${GITHUB_EVENT_NAME:-unset}' does not deploy" ;;
esac

[ "${GITHUB_WORKFLOW_REF:-}" = "$EXPECTED_WORKFLOW" ] \
  || refuse "workflow '${GITHUB_WORKFLOW_REF:-unset}' is not $EXPECTED_WORKFLOW"

echo "production runner: admitted ${GITHUB_WORKFLOW_REF} (${GITHUB_EVENT_NAME}, ${GITHUB_SHA:-?})"

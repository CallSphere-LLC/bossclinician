#!/usr/bin/env bash
# Job-started hook for the production runner. It decides which jobs may run on
# the production host at all.
#
# The runner has the deploy user's docker and sudo rights, and a workflow file
# lives on whatever branch pushed it. Without this hook, anyone able to push any
# branch could add a workflow with `runs-on: [self-hosted, bossclinician]` and
# run anything on the server. The check below admits exactly one thing: the
# deploy workflow as it exists on main of this repository, for a push to main
# or a manual dispatch.
#
# The repository is identified by its numeric id, not its name. The id did not
# change when the repository moved from a personal account into the
# organization, and does not change if either is renamed; a name check turns
# every such rename into a pipeline that silently refuses to deploy. A fork or
# any other repository has a different id.
#
# Installed as a copy OUTSIDE the repository, and wired up through
# ACTIONS_RUNNER_HOOK_JOB_STARTED in the runner's .env (see docs/CI-CD.md).
# A commit cannot loosen the rule it is judged by.
set -euo pipefail

EXPECTED_REPOSITORY_ID="${GUARD_EXPECTED_REPOSITORY_ID:-1350709869}"
DEPLOY_WORKFLOW=".github/workflows/deploy.yml@refs/heads/main"

refuse() {
  echo "::error::The production runner refused this job: $*" >&2
  exit 1
}

[ "${GITHUB_REPOSITORY_ID:-}" = "$EXPECTED_REPOSITORY_ID" ] \
  || refuse "repository id '${GITHUB_REPOSITORY_ID:-unset}' (${GITHUB_REPOSITORY:-unknown}) is not $EXPECTED_REPOSITORY_ID"

[ "${GITHUB_REF:-}" = "refs/heads/main" ] \
  || refuse "ref '${GITHUB_REF:-unset}' is not refs/heads/main"

case "${GITHUB_EVENT_NAME:-}" in
  push | workflow_dispatch) ;;
  *) refuse "event '${GITHUB_EVENT_NAME:-unset}' does not deploy" ;;
esac

# The workflow must be this repository's own deploy.yml, as it is on main.
[ -n "${GITHUB_REPOSITORY:-}" ] && [ "${GITHUB_WORKFLOW_REF:-}" = "$GITHUB_REPOSITORY/$DEPLOY_WORKFLOW" ] \
  || refuse "workflow '${GITHUB_WORKFLOW_REF:-unset}' is not ${GITHUB_REPOSITORY:-<repository>}/$DEPLOY_WORKFLOW"

echo "production runner: admitted ${GITHUB_WORKFLOW_REF} (repository id ${GITHUB_REPOSITORY_ID}, ${GITHUB_EVENT_NAME}, ${GITHUB_SHA:-?})"

# CI/CD: how a change reaches bossclinician.callsphere.site

**The rule:** code changes on your computer, goes to GitHub, and reaches
production only through this pipeline. Nobody edits `/opt/bossclinician` on the
server. The deploy refuses to run over a hand edit, and it says which file.

## Shipping a change

```bash
git pull origin main            # start from what is live
# …edit, then run the checks below…
git commit -am "What changed and why"
git push origin main
```

Then watch **GitHub → Actions → Deploy**. When it finishes green, the site is
serving your commit. To confirm from anywhere:

```bash
curl -s https://bossclinician.callsphere.site/api/health   # "release" is the live commit
```

Pushing any other branch, or opening a pull request, runs the same CI suite and
deploys nothing. Merging to main is what deploys.

## Running the checks before you push

CI runs these. Running them locally first saves a red build.

| What | Command |
|---|---|
| Backend typecheck, unit tests | `cd backend && npm ci && npm run typecheck && npm test` |
| Backend integration tests | needs Postgres: `TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres JWT_SECRET=x npx vitest run integration.test` |
| Frontend typecheck, unit tests | `cd frontend && npm ci && npm run typecheck && npm test` |
| AI service | `cd ai && pip install -r requirements.txt && python -m pytest -q` |
| Pipeline tests | `pip install pyyaml && python3 -m unittest discover -s scripts/ci/tests` |
| Secret scan | `scripts/ci/secret-scan.sh` |

## The pipeline

```mermaid
flowchart TD
  push["git push origin main"] --> resolve["resolve: pin the commit, prove it is on main"]
  resolve --> ci
  subgraph ci["CI: GitHub-hosted runners, in parallel"]
    p["pipeline: these tests, shellcheck, actionlint, secret scan"]
    b["backend: typecheck, unit, integration on real Postgres, build"]
    f["frontend: typecheck, unit"]
    a["ai: pytest"]
    s["stack: build production images, boot on an empty DB, smoke test"]
  end
  ci -->|every job green| guard["production runner: job guard admits only deploy.yml on main"]
  ci -->|any job red| stop["no deploy; site unchanged"]
  guard --> decide["decide: refuse / skip / verify / deploy"]
  decide -->|refuse| refused["exit 3; nothing touched"]
  decide -->|deploy| roll["tag running images for rollback, check out, build only what changed"]
  roll --> reload["nginx -t and reload, regenerate redirects from the DB"]
  reload --> gate{"health gate through the public URL: release matches, HTTP smoke"}
  gate -->|fail| rollback["restore checkout and images, reload, re-verify"]
  gate -->|pass| live["record release, prune old images, full smoke incl. DB/queue/TURN"]
```

### CI (`.github/workflows/ci.yml`)

Runs on GitHub's machines, never on the server.

| Job | Catches |
|---|---|
| `pipeline` | A broken deploy rule, shell script, or workflow; a committed credential or `.env` |
| `backend` | Type errors; unit regressions; the 274 database tests against a fresh Postgres with every migration applied from scratch; a lockfile out of sync |
| `frontend` | Type errors; unit regressions; a lockfile out of sync |
| `ai` | AI service regressions (fallback paths, no OpenAI key) |
| `stack` | What unit tests cannot see: a Dockerfile that no longer builds, a file `.dockerignore` drops, a migration or seed that fails on an empty database, an nginx config that does not load, SSR crashing at boot, a legacy redirect or paywall check failing, the image not carrying its commit |

### Deploy (`.github/workflows/deploy.yml` → `scripts/ci/deploy-release.sh`)

Runs on the runner installed on the production host. One deploy at a time;
never cancelled halfway.

1. **Decide** (`scripts/ci/release.py`, read-only). It refuses if the commit is
   not on main, the checkout has hand edits or unpushed commits, a required
   secret is missing, or the disk is low. It skips if a newer push has
   superseded this one, and only verifies if the commit is already live.
   Otherwise it works out what the change needs rebuilt (table below).
2. **Protect the rollback.** It tags the running images `:rollback` and holds
   the host's image-retention lock, so another app's cleanup cannot delete
   them.
3. **Check out** the commit in `/opt/bossclinician`.
4. **Build and restart only what changed** via `scripts/deploy.sh`, which waits
   for health checks. Migrations run at API startup.
5. **nginx:** `nginx -t`, then reload. The reload also re-resolves recreated
   containers.
6. **Redirects:** regenerate `nginx/redirects.map` from the database, so
   redirects added in the admin are never lost, and reload if the map changed.
7. **Health gate**, through the public URL. `/api/health` must report the new
   commit, and the HTTP smoke checks must pass. It retries for about two
   minutes.
8. **If any step from 3 on fails,** it rolls back: restores the checkout, the
   images and the redirect map, reloads nginx, re-runs the gate, and the job
   goes red.
9. **On success,** it records the release, prunes superseded images, and runs
   the full smoke test including database, job queue and TURN relay.

### What a change rebuilds

| Changed | Effect |
|---|---|
| `frontend/**`, `backend/Dockerfile`, `.dockerignore` | backend + frontend. They always ship together, because the API's server-rendered HTML names the browser bundle by hash |
| `backend/**` | backend |
| `backend/src/db/migrations/**` | backend; migrations apply at startup |
| `ai/app/**`, `ai/knowledge/**`, `ai/requirements.txt`, `ai/Dockerfile` | ai |
| `docker-compose.yml` | every service reconciled |
| `nginx/**` | validate + reload only |
| `k8s/**` | diff printed, **never applied** (see below) |
| docs, `*.md`, `scripts/**`, `.github/**`, `ai/tests/**`, `shared/**`, `*.env.example` | nothing restarts; the checkout still moves |

## Edge cases

Each row has a test in `scripts/ci/tests/` unless marked *design*.

| Situation | What happens |
|---|---|
| Push to a branch other than main, or a PR | CI only. Nothing deploys and nothing touches the server |
| A workflow on another branch targets the production runner | The runner's job guard refuses it before any step runs |
| A PR from a fork | GitHub-hosted CI only; no `pull_request_target` or `workflow_run` anywhere |
| Any CI job fails on main | Deploy is skipped; the live site is unchanged |
| Two pushes in quick succession | The older waiting deploy is replaced; if it starts anyway, it skips as superseded |
| An older run finishes after a newer deploy | Skipped; production is never rolled back by accident |
| Re-running a deploy for the commit that is already live | Verify only; nothing restarts |
| Force-push to main | The rewritten main deploys, including a force-push back to an older commit |
| Manual deploy of a commit not on main | Refused twice: by the `resolve` job, and again on the server |
| Someone edited a tracked file on the server | Refused; the file is named and the edit is left alone |
| A commit made on the server and never pushed | Refused |
| An untracked or ignored file sits where the commit adds one (e.g. a committed `backend/.env`) | Refused; the live file is not overwritten |
| A credential or `.env` file committed | CI fails the secret scan |
| A required server secret missing or blank | Refused before anything builds |
| A release adds a variable to an `.env.example` that the server lacks | Warning on the run; the deploy continues |
| Less than 10 GiB free | Refused |
| Docs-only or pipeline-only change | The checkout moves; nothing restarts |
| Frontend-only change | Both web images rebuild, because of the SSR coupling |
| AI-only change | Only `ai` rebuilds; the API is untouched |
| `docker-compose.yml` change | Every service is reconciled |
| nginx change | `nginx -t`, then reload; a rejected config rolls back and the old config reloads |
| Migration fails at startup | The API never goes healthy, so it rolls back. The database keeps whatever the migration committed |
| Build fails (type error, OOM, build-lock timeout) | Rolls back; running containers were never replaced |
| New container healthy but the site still serves the old release | The gate sees the release mismatch and rolls back |
| HTTP smoke checks fail after rollout | Rolls back |
| The rollback itself does not restore a healthy site | The job fails with a loud error; follow *When a rollback fails* below |
| Database, job queue or TURN checks fail after the gate passed | The job goes red with no rollback, because those are not proof the release is at fault |
| Redirects added in the admin | Regenerated from the database every deploy, and preserved across a rollback |
| `k8s/` changes | Diff printed, never applied |
| A Dockerfile starts copying a new directory | A pipeline test fails until the rebuild rules learn about it |
| CI's env writer run on the server by mistake | Refuses outside GitHub Actions and never overwrites a file |
| `package-lock.json` out of sync | `npm ci` fails CI |
| Another app is building on the host | Waits on the shared build lock up to 30 minutes, then fails and rolls back (*design*) |
| The runner is offline | The deploy job queues until it is back; GitHub drops it after 24h (*design*) |
| `[skip ci]` in the commit message | GitHub skips both CI and deploy (*design*; don't use it on main) |

## Rolling back

1. **Preferred:** `git revert <bad-sha>` on your computer, then push. The fix
   goes through CI like anything else, and main stays the truth.
2. **Fast, while you work on the revert:** GitHub → Actions → Deploy → *Run
   workflow* (branch `main`), and set **ref** to an older commit from main.
   Only commits made after this pipeline was added can be redeployed this way.
   The next push to main deploys main again, so still revert.
3. **The database does not roll back.** Migrations are forward-only. Write them
   so the previous release still runs against them (add columns, don't rename
   or drop in the same release).

## Changing secrets or server configuration

Secrets are the one thing that lives only on the server: `.env`,
`backend/.env`, `ai/.env`. They never go in git, and CI would fail if they did.
To change one:

1. Edit the file on the server.
2. GitHub → Actions → Deploy → *Run workflow* on `main`, with **force rebuild**
   ticked. That reconciles every service, so the new value reaches its
   container.

If a release needs a *new* variable, add it on the server **before** pushing
the code that reads it. The deploy warns when an `.env.example` gains a key the
server lacks.

## k8s manifests

The pipeline never applies `k8s/`.
`k8s/ingress-bossclinician-com.yaml` is deliberately unapplied until the
bossclinician.com cutover, and applying it early would send cert-manager after
a domain that does not point here. When `k8s/` changes, the deploy log shows
`kubectl diff`; apply by hand on the server with
`sudo k3s kubectl apply -f k8s/<file>`.

## The production runner

- **Where:** `/opt/actions-runner-bossclinician`, systemd service
  `actions.runner.shankasf-bossclinician.*`, label `bossclinician`. It is
  separate from `/opt/actions-runner-callsphere`, which serves another
  repository.
- **Install or re-register:** `RUNNER_TOKEN=<token> scripts/ci/install-runner.sh`.
  Get the token from repo Settings → Actions → Runners → New self-hosted
  runner; it is valid for one hour.
- **Job guard:** `hooks/job-started.sh` is a root-owned copy of
  `scripts/ci/runner-job-guard.sh`, wired through
  `ACTIONS_RUNNER_HOOK_JOB_STARTED` in the runner's `.env`. Changing the guard
  in git changes nothing until you re-run the install script.
- **Status and logs:** `sudo systemctl status 'actions.runner.shankasf-bossclinician.*'`,
  and `_diag/` in the runner directory.
- **Deploy history on the server:** `.git/bossclinician-deploy/history` and
  `last-deployed` in `/opt/bossclinician`.

## When a deploy fails

- **Refused (exit 3).** Nothing changed. The reason is the red annotation on
  the run: fix it (usually a hand edit on the server, or a missing secret),
  then re-run.
- **Rolled back.** The previous release is live. Fix forward on your computer
  and push.
- **Host checks failed after go-live.** The release is live. Look at the
  job queue's dead letters, the database, or the TURN relay as the log says.

### When a rollback fails

The site may be down. On the server:

```bash
cd /opt/bossclinician
tail -5 .git/bossclinician-deploy/history     # last good release is on the right of the last line that succeeded
docker compose ps
docker compose logs --tail=200 backend
git checkout -B main <last-good-sha>
./scripts/deploy.sh                           # break-glass: builds what is checked out
./scripts/smoke-test.sh
```

Then find out why before pushing again.

## Limits worth knowing

- **Write access to the repo is production access.** A push to main deploys;
  that is the point. The job guard stops workflows on *other* branches from
  running on the server, but it cannot stop a push to main. Keep write access
  to people you trust. To gate others behind review, add a branch ruleset that
  requires a pull request for them.
- **GitHub Actions minutes.** The repository is private, so CI consumes the
  account's minutes. The `stack` job, which builds every image, is the largest
  part.
- **A backend or frontend deploy restarts the API.** Expect a few seconds of API
  errors while the new container starts. Marketing pages fall back to the SPA
  shell meanwhile; nginx is never down.
- **CI does not exercise Stripe, SES, OpenAI or the TURN relay.** They need real
  credentials. The post-deploy smoke test covers TURN on the server.

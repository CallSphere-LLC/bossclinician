#!/usr/bin/env python3
"""Decides whether one commit may go to production, and what deploying it takes.

Read-only. It fetches, inspects and prints; it never moves the checkout and
never touches a container. scripts/ci/deploy-release.sh acts on its answer.

    release.py check --repo /opt/bossclinician --target <sha> --event push
    release.py plan <path>...        # which services a set of changed paths rebuilds

`check` prints shell assignments (safe to `source`) and exits
    0  ACTION is deploy, verify or skip
    3  refused; the reason is on stderr as a GitHub ::error:: annotation
    2  bad invocation

Standard library only, so it runs unchanged on the production host and on a
GitHub-hosted runner. Every rule here has a case in tests/test_release.py.
"""
from __future__ import annotations

import argparse
import os
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Services docker-compose.yml builds from this repository. db, nginx and coturn
# run upstream images; their configuration changes arrive through
# docker-compose.yml or nginx/, never through a build.
BUILT_SERVICES = ("ai", "backend", "frontend")

# The one tracked file production rewrites on purpose. nginx serves the legacy
# 301s from it, and it is generated from the `redirects` table, which the admin
# edits, so the live copy may legitimately differ from git. The deploy
# regenerates it from the database instead of trusting either copy.
GENERATED_FILES = frozenset({"nginx/redirects.map"})

# docker-compose.yml refuses to start without the first four (`${VAR:?}`), and a
# browser bundle built without the publishable key cannot open a payment form.
REQUIRED_ROOT_ENV = (
    "DB_PASSWORD",
    "TURN_HOST",
    "TURN_PORT",
    "TURN_STATIC_AUTH_SECRET",
    "VITE_STRIPE_PUBLISHABLE_KEY",
)
# config/env.ts throws at import without it, so the API would never go healthy.
REQUIRED_BACKEND_ENV = ("JWT_SECRET",)

# Checked against the variables a release *adds* to an example file, so an
# optional variable production has never set does not warn on every deploy.
ENV_EXAMPLES = {"backend/.env.example": "backend/.env", "ai/.env.example": "ai/.env"}


class Refused(Exception):
    """The deploy must not proceed. The message is written for a human."""


@dataclass
class Plan:
    services: set[str] = field(default_factory=set)
    compose_changed: bool = False
    nginx_changed: bool = False
    k8s_changed: bool = False
    migrations_changed: bool = False
    notes: list[str] = field(default_factory=list)


@dataclass
class Decision:
    action: str  # deploy | verify | skip
    reason: str
    head: str
    target: str
    origin_tip: str
    plan: Plan = field(default_factory=Plan)
    rollback: bool = False
    warnings: list[str] = field(default_factory=list)


def classify(paths, force_rebuild: bool = False) -> Plan:
    """Maps changed paths to the work a deploy has to do.

    Rebuilding more than necessary is not free here: every backend build bakes
    in a new APP_RELEASE, so it produces a new image and restarts the API. Each
    rule therefore follows what the Dockerfiles actually copy.
    """
    plan = Plan()
    for path in sorted(set(paths)):
        if path.endswith(".env.example"):
            # Excluded from every build context by .dockerignore; a rebuild would
            # change nothing. What it can mean is a new secret the server lacks.
            plan.notes.append(
                f"{path} changed. If it adds a variable production needs, set it in the "
                "server's matching .env before relying on it; the pipeline never writes secrets."
            )
        elif path == "docker-compose.yml":
            plan.compose_changed = True
            plan.services.update(BUILT_SERVICES)
        elif path in (".dockerignore", "backend/Dockerfile") or path.startswith("frontend/"):
            # One Dockerfile, one Vite build, two images: the API carries the
            # server-rendered app and names the browser bundle by content hash,
            # and the frontend image holds that bundle. They always ship together.
            plan.services.update(("backend", "frontend"))
        elif path.startswith("backend/"):
            plan.services.add("backend")
            if path.startswith("backend/src/db/migrations/") or path == "backend/src/db/schema.sql":
                plan.migrations_changed = True
        elif path in ("ai/Dockerfile", "ai/requirements.txt", "ai/.dockerignore") or path.startswith(
            ("ai/app/", "ai/knowledge/")
        ):
            # ai/tests, ai/README.md and build_kb.py are not copied into the image.
            plan.services.add("ai")
        elif path.startswith("nginx/"):
            plan.nginx_changed = True
        elif path.startswith("k8s/"):
            plan.k8s_changed = True
        elif path == "shared/content.json":
            plan.notes.append(
                "shared/content.json changed. The chat widget's knowledge base is generated from it "
                "at dev time: run ai/build_kb.py locally and commit ai/knowledge/site.md."
            )
    if force_rebuild:
        # Reconcile everything, as a compose change does. This is also how a
        # secret edited in a server .env reaches its containers: compose
        # recreates any service whose resolved configuration changed.
        plan.compose_changed = True
        plan.services.update(BUILT_SERVICES)
    if plan.k8s_changed:
        plan.notes.append(
            "k8s/ changed. The pipeline never applies manifests: k8s/ingress-bossclinician-com.yaml is "
            "deliberately unapplied until the bossclinician.com cutover, and applying it early would "
            "send cert-manager after a domain that does not point here. Review "
            "`sudo k3s kubectl diff -f k8s/` on the server and apply by hand."
        )
    return plan


def _git(repo: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if check and result.returncode != 0:
        raise Refused(f"`git {' '.join(args)}` failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if line]


def _is_ancestor(repo: Path, older: str, newer: str) -> bool:
    return (
        subprocess.run(
            ["git", "-C", str(repo), "merge-base", "--is-ancestor", older, newer], capture_output=True
        ).returncode
        == 0
    )


def parse_env(text: str) -> dict[str, str]:
    """The subset of dotenv syntax compose and dotenv agree on."""
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def read_env(path: Path) -> dict[str, str]:
    return parse_env(path.read_text())


def _example_keys(repo: Path, commit: str, path: str) -> set[str]:
    # A commit without the file has no keys, not an error.
    return set(parse_env(_git(repo, "show", f"{commit}:{path}", check=False)))


def _check_env_files(repo: Path) -> None:
    root = repo / ".env"
    if not root.is_file():
        raise Refused(f"{root} is missing. docker-compose.yml cannot start without it.")
    values = read_env(root)
    missing = [k for k in REQUIRED_ROOT_ENV if not values.get(k)]
    if missing:
        raise Refused(f"{root} has no value for {', '.join(missing)}.")

    backend = repo / "backend" / ".env"
    if not backend.is_file():
        raise Refused(f"{backend} is missing. The API reads its secrets from it.")
    values = read_env(backend)
    missing = [k for k in REQUIRED_BACKEND_ENV if not values.get(k)]
    if missing:
        raise Refused(f"{backend} has no value for {', '.join(missing)}; the API would never go healthy.")

    if not (repo / "ai" / ".env").is_file():
        raise Refused(f"{repo / 'ai' / '.env'} is missing. docker-compose.yml names it as the ai env_file.")


def decide(
    repo,
    target: str,
    event: str,
    *,
    remote: str = "origin",
    branch: str = "main",
    state_dir=None,
    force_rebuild: bool = False,
    min_free_gb: float = 10.0,
    fetch: bool = True,
) -> Decision:
    repo = Path(repo)
    state_dir = Path(state_dir) if state_dir else repo / ".git" / "bossclinician-deploy"

    if event not in ("push", "workflow_dispatch"):
        raise Refused(
            f"trigger {event!r} does not deploy; production changes only on a push to {branch} "
            "or a manual dispatch."
        )

    if fetch:
        _git(repo, "fetch", "--prune", "--quiet", remote)

    resolved = _git(repo, "rev-parse", "--verify", "--quiet", f"{target}^{{commit}}", check=False)
    if not resolved:
        raise Refused(f"{target} is not a commit this server can see, even after fetching {remote}.")
    tip = _git(repo, "rev-parse", f"{remote}/{branch}")
    if not _is_ancestor(repo, resolved, tip):
        raise Refused(f"{resolved[:12]} is not on {remote}/{branch}. Only commits on {branch} go to production.")

    head = _git(repo, "rev-parse", "HEAD")

    # Nobody edits production in place. If somebody did, a checkout would
    # either fail halfway or silently destroy the edit, so stop and say so.
    dirty = [p for p in _lines(_git(repo, "diff", "--name-only", "HEAD")) if p not in GENERATED_FILES]
    if dirty:
        shown = ", ".join(dirty[:20]) + (" …" if len(dirty) > 20 else "")
        raise Refused(
            f"the server's checkout has uncommitted edits to tracked files ({shown}). A deploy would "
            "overwrite them. Make the change on your computer and push it; then discard the edit on the server."
        )

    last_deployed_file = state_dir / "last-deployed"
    last_deployed = last_deployed_file.read_text().strip() if last_deployed_file.is_file() else ""
    if head != last_deployed and not _git(repo, "branch", "-r", "--contains", head):
        raise Refused(
            f"the server is on {head[:12]}, which is on no branch of {remote} and was not put there by "
            "the pipeline. Those commits exist only on this server; push them from wherever they were "
            "made, or reset the server's checkout, before deploying."
        )

    if event == "push" and resolved != tip:
        return Decision(
            "skip",
            f"superseded: {remote}/{branch} has moved on to {tip[:12]}, which deploys in its own run.",
            head,
            resolved,
            tip,
        )

    if resolved == head and not force_rebuild:
        return Decision("verify", f"{resolved[:12]} is already live; verifying the site only.", head, resolved, tip)

    warnings: list[str] = []
    rollback = resolved != head and _is_ancestor(repo, resolved, head)
    if rollback:
        warnings.append(
            f"{resolved[:12]} is older than the live {head[:12]}: this is a rollback. The database keeps "
            "every migration the newer release applied; the older code must tolerate them."
        )

    changed = _lines(_git(repo, "diff", "--name-only", "--no-renames", head, resolved))
    plan = classify(changed, force_rebuild)

    added = _lines(_git(repo, "diff", "--name-only", "--no-renames", "--diff-filter=A", head, resolved))
    in_the_way = [p for p in added if os.path.lexists(repo / p)]
    if in_the_way:
        raise Refused(
            "untracked files on the server sit where this commit puts tracked files, and the checkout "
            f"would overwrite them: {', '.join(in_the_way[:20])}. Move them aside if they matter."
        )

    _check_env_files(repo)

    for example, live in ENV_EXAMPLES.items():
        live_path = repo / live
        if not live_path.is_file():
            continue
        introduced = _example_keys(repo, resolved, example) - _example_keys(repo, head, example)
        unset = sorted(k for k in introduced if k not in read_env(live_path))
        if unset:
            warnings.append(
                f"this release adds {', '.join(unset)} to {example}, and the server's {live} does not set "
                "them. Fine if they are optional; otherwise add them on the server."
            )

    free_gb = shutil.disk_usage(repo).free / 2**30
    if free_gb < min_free_gb:
        raise Refused(
            f"only {free_gb:.1f} GiB free on the disk holding {repo}; a build needs at least {min_free_gb:g}. "
            "This host is shared, so free space deliberately rather than pruning blindly."
        )

    return Decision(
        "deploy",
        f"deploying {resolved[:12]} over {head[:12]}.",
        head,
        resolved,
        tip,
        plan=plan,
        rollback=rollback,
        warnings=warnings,
    )


def emit(decision: Decision, out=sys.stdout, err=sys.stderr) -> None:
    flag = lambda b: "true" if b else "false"  # noqa: E731
    fields = {
        "ACTION": decision.action,
        "REASON": decision.reason,
        "HEAD": decision.head,
        "TARGET": decision.target,
        "ORIGIN_TIP": decision.origin_tip,
        "SERVICES": " ".join(sorted(decision.plan.services)),
        "COMPOSE_CHANGED": flag(decision.plan.compose_changed),
        "NGINX_CHANGED": flag(decision.plan.nginx_changed),
        "K8S_CHANGED": flag(decision.plan.k8s_changed),
        "MIGRATIONS_CHANGED": flag(decision.plan.migrations_changed),
        "ROLLBACK": flag(decision.rollback),
    }
    for key, value in fields.items():
        print(f"{key}={shlex.quote(value)}", file=out)
    for message in decision.warnings + decision.plan.notes:
        print(f"::warning::{message}", file=err)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="decide whether a commit may be deployed")
    check.add_argument("--repo", default=".")
    check.add_argument("--target", required=True)
    check.add_argument("--event", required=True)
    check.add_argument("--state-dir")
    check.add_argument("--remote", default="origin")
    check.add_argument("--branch", default="main")
    check.add_argument("--force-rebuild", action="store_true")
    check.add_argument("--min-free-gb", type=float, default=10.0)
    check.add_argument("--no-fetch", action="store_true")

    plan = sub.add_parser("plan", help="show what a set of changed paths would rebuild")
    plan.add_argument("paths", nargs="*")

    args = parser.parse_args(argv)

    if args.command == "plan":
        result = classify(args.paths)
        emit(Decision("plan", "", "", "", "", plan=result))
        return 0

    try:
        decision = decide(
            args.repo,
            args.target,
            args.event,
            remote=args.remote,
            branch=args.branch,
            state_dir=args.state_dir,
            force_rebuild=args.force_rebuild,
            min_free_gb=args.min_free_gb,
            fetch=not args.no_fetch,
        )
    except Refused as exc:
        print(f"::error::Deploy refused: {exc}", file=sys.stderr)
        return 3
    emit(decision)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Fixtures for the deploy pipeline tests.

Real git repositories in a temp directory (an origin, a developer clone that
pushes, and a server clone standing in for /opt/bossclinician), plus stub
`docker`, `curl`, `sudo` and smoke-test commands that record what they were
asked to do and fail on request.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CI_DIR = REPO_ROOT / "scripts" / "ci"

GIT_ENV = {
    "GIT_AUTHOR_NAME": "Pipeline Test",
    "GIT_AUTHOR_EMAIL": "pipeline-test@example.com",
    "GIT_COMMITTER_NAME": "Pipeline Test",
    "GIT_COMMITTER_EMAIL": "pipeline-test@example.com",
    # Isolate from the machine's git config: credential helpers, hooks, a
    # different default branch.
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_TERMINAL_PROMPT": "0",
}


def run(cmd, cwd=None, env=None, check=True) -> subprocess.CompletedProcess:
    merged = {**os.environ, **GIT_ENV, **(env or {})}
    result = subprocess.run([str(c) for c in cmd], cwd=cwd, env=merged, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise AssertionError(
            f"{cmd} exited {result.returncode}\n--- stdout\n{result.stdout}\n--- stderr\n{result.stderr}"
        )
    return result


REDIRECTS_V1 = "# GENERATED FILE\n# Generated from 1 rows.\nmap $uri $redirect_target {\n  /old /new;\n}\n"

BASE_FILES = {
    ".gitignore": ".env\n**/.env\nnode_modules/\n",
    "README.md": "# app\n",
    "docker-compose.yml": "services: {}\n",
    "backend/Dockerfile": "FROM scratch\n",
    "backend/src/server.ts": "export {};\n",
    "backend/.env.example": "JWT_SECRET=\n",
    "frontend/src/main.tsx": "export {};\n",
    "ai/app/main.py": "",
    "ai/.env.example": "OPENAI_API_KEY=\n",
    "nginx/site.conf": "server {}\n",
    "nginx/redirects.map": REDIRECTS_V1,
    "k8s/ingress.yaml": "kind: Ingress\n",
    "docs/notes.md": "notes\n",
}

SERVER_ENV = {
    ".env": (
        "DB_PASSWORD=x\nTURN_HOST=127.0.0.1\nTURN_PORT=3479\n"
        "TURN_STATIC_AUTH_SECRET=y\nVITE_STRIPE_PUBLISHABLE_KEY=pk_test_z\n"
    ),
    "backend/.env": "JWT_SECRET=secret\n",
    "ai/.env": "OPENAI_API_KEY=\n",
}


class Scenario:
    def __init__(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="bc-pipeline-"))
        self.origin = self.tmp / "origin.git"
        self.dev = self.tmp / "dev"
        # Named like the production checkout: compose derives image names from it.
        self.server = self.tmp / "bossclinician"
        run(["git", "init", "-q", "--bare", "-b", "main", self.origin])
        run(["git", "init", "-q", "-b", "main", self.dev])
        self.git(self.dev, "remote", "add", "origin", str(self.origin))
        self.base = self.commit(BASE_FILES, "base")
        run(["git", "clone", "-q", self.origin, self.server])
        for path, content in SERVER_ENV.items():
            self.write(self.server, path, content)

    def cleanup(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @staticmethod
    def write(root, path, content):
        target = Path(root) / path
        if content is None:
            target.unlink()
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    @staticmethod
    def git(root, *args, check=True) -> str:
        return run(["git", "-C", root, *args], check=check).stdout.strip()

    def commit(self, files, message="change", push=True, force=False, add_ignored=False) -> str:
        for path, content in files.items():
            self.write(self.dev, path, content)
        self.git(self.dev, "add", "-A")
        if add_ignored:
            self.git(self.dev, "add", "-f", *[p for p, c in files.items() if c is not None])
        self.git(self.dev, "commit", "-q", "--allow-empty", "-m", message)
        if push:
            self.git(self.dev, "push", "-q", *(["--force"] if force else []), "origin", "HEAD:main")
        return self.git(self.dev, "rev-parse", "HEAD")

    def server_head(self) -> str:
        return self.git(self.server, "rev-parse", "HEAD")

    def fast_forward_server(self, sha: str):
        """Put the server on `sha` the way a successful deploy would."""
        self.git(self.server, "fetch", "-q", "origin")
        self.git(self.server, "checkout", "-q", "-B", "main", sha)
        state = self.server / ".git" / "bossclinician-deploy"
        state.mkdir(parents=True, exist_ok=True)
        (state / "last-deployed").write_text(sha + "\n")


DOCKER_STUB = r'''#!/usr/bin/env python3
import json, os, re, shutil, sys
from pathlib import Path

args = sys.argv[1:]
line = " ".join(args)
state = Path(os.environ["STUB_STATE"])
with open(state / "docker.log", "a") as log:
    log.write(json.dumps({"args": args, "APP_RELEASE": os.environ.get("APP_RELEASE", "")}) + "\n")

fail = os.environ.get("STUB_DOCKER_FAIL")
if fail and re.search(fail, line):
    print(f"stub docker: failing `{line}`", file=sys.stderr)
    sys.exit(1)

# nginx -t fails while the checked-out config is marked broken, like the real one.
if line.endswith("nginx nginx -t"):
    conf = Path.cwd() / "nginx" / "site.conf"
    sys.exit(1 if conf.exists() and "BROKEN" in conf.read_text() else 0)

if args[:2] == ["compose", "ps"]:
    print(f"cid-{args[-1]}")
elif args[:1] == ["inspect"]:
    print(f"sha256:running-{args[-1].removeprefix('cid-')}")
elif args[:2] == ["compose", "build"]:
    services = [a for a in args[2:] if not a.startswith("-")]
    if not services or "backend" in services:
        (state / "release").write_text(os.environ.get("APP_RELEASE", ""))
elif args[:1] == ["tag"] and args[1].endswith("-backend:rollback") and args[2].endswith(":latest"):
    (state / "release").write_text("rolled-back")
elif args[:2] == ["compose", "cp"]:
    source = state / "db-redirects.map"
    if not source.exists():
        sys.exit(1)
    shutil.copy(source, args[-1])
'''

CURL_STUB = r'''#!/usr/bin/env python3
import json, os, re, sys
from pathlib import Path

state = Path(os.environ["STUB_STATE"])
url = next((a for a in sys.argv[1:] if a.startswith("http")), "")
with open(state / "curl.log", "a") as log:
    log.write(url + "\n")
fail = os.environ.get("STUB_CURL_FAIL")
if fail and re.search(fail, url):
    sys.exit(22)
if url.endswith("/api/health"):
    pinned, built = state / "release-pinned", state / "release"
    release = pinned.read_text() if pinned.exists() else (built.read_text() if built.exists() else "dev")
    print(json.dumps({"ok": True, "release": release}))
'''

SUDO_STUB = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path

with open(Path(os.environ["STUB_STATE"]) / "sudo.log", "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\n")
'''

# Gate runs set SMOKE_SKIP_HOST_CHECKS=1; the post-deploy run does not.
# `smoke-gate-failures` holds how many more gate runs should fail.
SMOKE_STUB = r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path

state = Path(os.environ["STUB_STATE"])
gate = os.environ.get("SMOKE_SKIP_HOST_CHECKS") == "1"
with open(state / "smoke.log", "a") as log:
    log.write(("gate" if gate else "full") + "\n")
if gate:
    counter = state / "smoke-gate-failures"
    remaining = int(counter.read_text()) if counter.exists() else 0
    if remaining != 0:
        if remaining > 0:
            counter.write_text(str(remaining - 1))
        sys.exit(1)
elif (state / "smoke-full-fail").exists():
    sys.exit(1)
'''


class Stubs:
    def __init__(self, root: Path):
        self.bin = root / "stub-bin"
        self.state = root / "stub-state"
        self.bin.mkdir()
        self.state.mkdir()
        for name, body in {"docker": DOCKER_STUB, "curl": CURL_STUB, "sudo": SUDO_STUB, "smoke": SMOKE_STUB}.items():
            path = self.bin / name
            path.write_text(body)
            path.chmod(0o755)

    def docker_calls(self) -> list[list[str]]:
        log = self.state / "docker.log"
        return [json.loads(l)["args"] for l in log.read_text().splitlines()] if log.exists() else []

    def docker_records(self) -> list[dict]:
        log = self.state / "docker.log"
        return [json.loads(l) for l in log.read_text().splitlines()] if log.exists() else []

    def sudo_calls(self) -> list[list[str]]:
        log = self.state / "sudo.log"
        return [json.loads(l) for l in log.read_text().splitlines()] if log.exists() else []

    def smoke_runs(self) -> list[str]:
        log = self.state / "smoke.log"
        return log.read_text().splitlines() if log.exists() else []

    def set(self, name: str, content: str):
        (self.state / name).write_text(content)


def run_deploy(scenario: Scenario, stubs: Stubs, target: str, event: str = "push", **extra):
    env = {
        "PATH": f"{stubs.bin}{os.pathsep}{os.environ['PATH']}",
        "STUB_STATE": str(stubs.state),
        "TARGET_SHA": target,
        "EVENT_NAME": event,
        "DEPLOY_DIR": str(scenario.server),
        "LOCK_DIR": str(scenario.tmp / "lock"),
        "MIN_FREE_GB": "0",
        "GATE_ATTEMPTS": "2",
        "GATE_INTERVAL": "0",
        "SMOKE_TEST": str(stubs.bin / "smoke"),
        "SITE_URL": "https://site.test",
        "ADMIN_URL": "https://admin.site.test",
        "GITHUB_STEP_SUMMARY": str(scenario.tmp / "summary.md"),
        **extra,
    }
    return run(["bash", CI_DIR / "deploy-release.sh"], env=env, check=False)

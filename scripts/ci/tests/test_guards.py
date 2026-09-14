"""The three scripts that stop a mistake before it happens: the production
runner's job guard, the secret scan, and the CI env writer's refusal to run
anywhere it could overwrite real secrets."""
from __future__ import annotations

import re
import shutil
import tempfile
import unittest
from pathlib import Path

from helpers import CI_DIR, REPO_ROOT, run

GUARD = CI_DIR / "runner-job-guard.sh"
REPOSITORY_ID = "1350709869"
ADMITTED = {
    "GITHUB_REPOSITORY": "CallSphere-LLC/bossclinician",
    "GITHUB_REPOSITORY_ID": REPOSITORY_ID,
    "GITHUB_REF": "refs/heads/main",
    "GITHUB_EVENT_NAME": "push",
    "GITHUB_WORKFLOW_REF": "CallSphere-LLC/bossclinician/.github/workflows/deploy.yml@refs/heads/main",
    "GITHUB_SHA": "a" * 40,
}


class RunnerGuardTests(unittest.TestCase):
    def guard(self, **overrides):
        env = {**ADMITTED, **overrides}
        env = {k: v for k, v in env.items() if v is not None}
        # Start from an environment without the runner's GITHUB_* variables.
        base = {"PATH": "/usr/bin:/bin"}
        return run(["env", "-i", *[f"{k}={v}" for k, v in {**base, **env}.items()], "bash", GUARD], check=False)

    def test_admits_the_deploy_workflow_on_main_for_a_push(self):
        self.assertEqual(self.guard().returncode, 0)

    def test_admits_a_manual_dispatch_on_main(self):
        self.assertEqual(self.guard(GITHUB_EVENT_NAME="workflow_dispatch").returncode, 0)

    def test_refuses_a_workflow_pushed_on_another_branch(self):
        result = self.guard(
            GITHUB_REF="refs/heads/meena",
            GITHUB_WORKFLOW_REF="CallSphere-LLC/bossclinician/.github/workflows/deploy.yml@refs/heads/meena",
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("refs/heads/meena", result.stderr)

    def test_refuses_a_different_workflow_file_even_on_main(self):
        result = self.guard(GITHUB_WORKFLOW_REF="CallSphere-LLC/bossclinician/.github/workflows/sneaky.yml@refs/heads/main")
        self.assertEqual(result.returncode, 1)

    def test_refuses_pull_request_events(self):
        for event in ("pull_request", "pull_request_target", "workflow_run", "schedule"):
            self.assertEqual(self.guard(GITHUB_EVENT_NAME=event).returncode, 1, event)

    def test_still_admits_after_the_organization_is_renamed(self):
        # The id is what survived the move from shankasf/ into the organization.
        result = self.guard(
            GITHUB_REPOSITORY="CallSphere-Inc/bossclinician",
            GITHUB_WORKFLOW_REF="CallSphere-Inc/bossclinician/.github/workflows/deploy.yml@refs/heads/main",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_refuses_a_fork_even_with_an_identical_name_and_workflow(self):
        result = self.guard(GITHUB_REPOSITORY_ID="999999999")
        self.assertEqual(result.returncode, 1)
        self.assertIn("999999999", result.stderr)

    def test_refuses_a_workflow_that_belongs_to_another_repository(self):
        result = self.guard(GITHUB_WORKFLOW_REF="someone/elsewhere/.github/workflows/deploy.yml@refs/heads/main")
        self.assertEqual(result.returncode, 1)

    def test_refuses_when_the_runner_provides_no_context(self):
        for missing in ("GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY", "GITHUB_WORKFLOW_REF", "GITHUB_REF"):
            self.assertEqual(self.guard(**{missing: None}).returncode, 1, missing)

    def test_guard_names_a_workflow_that_exists(self):
        self.assertTrue((REPO_ROOT / ".github/workflows/deploy.yml").is_file())

    def test_deploy_workflow_and_guard_agree_on_the_repository_id(self):
        # Two copies of one number: if they drift, every deploy is either skipped
        # by the workflow or refused by the runner.
        guard_default = re.search(r"GUARD_EXPECTED_REPOSITORY_ID:-(\d+)", GUARD.read_text()).group(1)
        workflow = (REPO_ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertIn(f"github.repository_id == '{guard_default}'", workflow)
        self.assertEqual(guard_default, REPOSITORY_ID)


class SecretScanTests(unittest.TestCase):
    def setUp(self):
        self.repo = Path(tempfile.mkdtemp(prefix="bc-scan-"))
        self.addCleanup(shutil.rmtree, self.repo, True)
        run(["git", "init", "-q", "-b", "main", self.repo])
        (self.repo / "README.md").write_text("hello\n")
        (self.repo / "backend").mkdir()
        (self.repo / "backend/.env.example").write_text("JWT_SECRET=\n")

    def scan(self):
        run(["git", "-C", self.repo, "add", "-A", "-f"])
        return run(["bash", CI_DIR / "secret-scan.sh", self.repo], check=False)

    def test_clean_tree_passes(self):
        self.assertEqual(self.scan().returncode, 0)

    def test_committed_credentials_fail(self):
        # Assembled at runtime so this file never matches the scan itself.
        samples = {
            "aws": "AKIA" + "ABCDEFGHIJKLMNOP",
            "stripe": "sk_" + "live_" + "a1B2c3D4e5F6g7H8i9J0",
            "webhook": "whsec_" + "a1B2c3D4e5F6g7H8i9J0k1L2",
            "openai": "sk-" + "proj-" + "abcdefghijklmnopqrstuvwxyz",
            "github": "ghp_" + "a" * 36,
            "pem": "-----BEGIN " + "RSA PRIVATE KEY-----",
        }
        for name, secret in samples.items():
            with self.subTest(name):
                (self.repo / "config.ts").write_text(f"const key = '{secret}';\n")
                self.assertEqual(self.scan().returncode, 1)
        (self.repo / "config.ts").unlink()

    def test_test_mode_and_publishable_stripe_keys_are_fine(self):
        (self.repo / "config.ts").write_text("const a = 'pk_live_" + "x" * 24 + "'; const b = 'sk_test_" + "y" * 24 + "';\n")
        self.assertEqual(self.scan().returncode, 0)

    def test_tracked_env_file_fails(self):
        for name in ("backend/.env", ".env.production"):
            with self.subTest(name):
                (self.repo / name).write_text("X=1\n")
                self.assertEqual(self.scan().returncode, 1)
                run(["git", "-C", self.repo, "rm", "-q", "--cached", name])
                (self.repo / name).unlink()

    def test_the_real_repository_is_clean(self):
        self.assertEqual(run(["bash", CI_DIR / "secret-scan.sh", REPO_ROOT], check=False).returncode, 0)


class WriteEnvTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="bc-env-"))
        self.addCleanup(shutil.rmtree, self.root, True)
        (self.root / ".github/ci").mkdir(parents=True)
        (self.root / "backend").mkdir()
        (self.root / "ai").mkdir()
        shutil.copy(REPO_ROOT / ".github/ci/write-env.sh", self.root / ".github/ci/write-env.sh")

    def write_env(self, **env):
        return run(["bash", self.root / ".github/ci/write-env.sh"], env={"GITHUB_ACTIONS": "", **env}, check=False)

    def test_refuses_outside_github_actions(self):
        self.assertEqual(self.write_env().returncode, 1)
        self.assertFalse((self.root / ".env").exists())

    def test_never_overwrites_an_existing_env_file(self):
        (self.root / ".env").write_text("DB_PASSWORD=the-real-one\n")
        self.assertNotEqual(self.write_env(GITHUB_ACTIONS="true").returncode, 0)
        self.assertEqual((self.root / ".env").read_text(), "DB_PASSWORD=the-real-one\n")

    def test_writes_all_three_files_in_ci(self):
        self.assertEqual(self.write_env(GITHUB_ACTIONS="true").returncode, 0)
        for name in (".env", "backend/.env", "ai/.env"):
            self.assertTrue((self.root / name).is_file(), name)
        self.assertIn("APP_ENV=staging", (self.root / "backend/.env").read_text())


if __name__ == "__main__":
    unittest.main()

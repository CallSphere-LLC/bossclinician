"""Every path through scripts/ci/deploy-release.sh, with docker, curl, sudo and
the smoke test stubbed and git real.

The question each test answers is the one that matters in production: after
this run, what is the server's checkout on, what did docker get asked to do,
and is the previous release still recoverable?
"""
from __future__ import annotations

import unittest

from helpers import REDIRECTS_V1, Scenario, Stubs, run_deploy


def has(calls, *prefix):
    return any(call[: len(prefix)] == list(prefix) for call in calls)


class DeployReleaseTests(unittest.TestCase):
    def setUp(self):
        self.s = Scenario()
        self.addCleanup(self.s.cleanup)
        self.stubs = Stubs(self.s.tmp)
        self.last_deployed = self.s.server / ".git" / "bossclinician-deploy" / "last-deployed"

    def deploy(self, target, event="push", **env):
        return run_deploy(self.s, self.stubs, target, event, **env)

    def summary(self):
        path = self.s.tmp / "summary.md"
        return path.read_text() if path.exists() else ""

    def assertExit(self, result, code):
        self.assertEqual(result.returncode, code, f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}")

    # --- success paths ------------------------------------------------------

    def test_frontend_change_builds_both_web_images_verifies_and_prunes(self):
        sha = self.s.commit({"frontend/src/main.tsx": "export const v = 2;\n"})
        result = self.deploy(sha)
        self.assertExit(result, 0)

        calls = self.stubs.docker_calls()
        self.assertTrue(has(calls, "compose", "build", "backend", "frontend"))
        self.assertTrue(has(calls, "compose", "up", "-d", "--wait", "backend", "frontend"))
        self.assertTrue(has(calls, "tag", "sha256:running-backend", "bossclinician-backend:rollback"))
        self.assertTrue(has(calls, "tag", "sha256:running-frontend", "bossclinician-frontend:rollback"))
        self.assertFalse(has(calls, "compose", "up", "-d", "--wait", "--no-build"))
        build = next(r for r in self.stubs.docker_records() if r["args"][:2] == ["compose", "build"])
        self.assertEqual(build["APP_RELEASE"], sha, "the image must carry the commit it was built from")

        self.assertEqual(self.s.server_head(), sha)
        self.assertEqual(self.last_deployed.read_text().strip(), sha)
        self.assertEqual(self.stubs.smoke_runs(), ["gate", "full"])
        self.assertIn(["-n", "/usr/local/sbin/callsphere-image-prune", "reclaim", "--post-deploy"],
                      self.stubs.sudo_calls())
        self.assertIn("Live:", self.summary())

    def test_prune_happens_only_after_the_gate(self):
        sha = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        self.stubs.set("smoke-gate-failures", "1")  # first gate attempt fails, second passes
        self.assertExit(self.deploy(sha), 0)
        self.assertEqual(self.stubs.smoke_runs(), ["gate", "gate", "full"])
        self.assertEqual(len(self.stubs.sudo_calls()), 1)

    def test_docs_only_change_moves_the_checkout_and_restarts_nothing(self):
        sha = self.s.commit({"docs/notes.md": "updated\n", "README.md": "# app v2\n"})
        self.assertExit(self.deploy(sha), 0)
        calls = self.stubs.docker_calls()
        self.assertFalse(has(calls, "compose", "build"))
        self.assertFalse(has(calls, "compose", "up"))
        self.assertEqual(self.s.server_head(), sha)
        self.assertEqual(self.stubs.sudo_calls(), [], "nothing was built, so nothing to prune")

    def test_ai_only_change_rebuilds_ai_and_does_not_expect_a_new_api_release(self):
        self.stubs.set("release", "previous-api-build")
        sha = self.s.commit({"ai/app/main.py": "x = 2\n"})
        self.assertExit(self.deploy(sha), 0)
        calls = self.stubs.docker_calls()
        self.assertTrue(has(calls, "compose", "build", "ai"))
        self.assertFalse(any("backend" in c for c in calls if c[:2] == ["compose", "build"]))

    def test_compose_change_reconciles_every_service(self):
        sha = self.s.commit({"docker-compose.yml": "services: {x: {}}\n"})
        self.assertExit(self.deploy(sha), 0)
        calls = self.stubs.docker_calls()
        self.assertIn(["compose", "build"], calls)
        self.assertIn(["compose", "up", "-d", "--wait"], calls)

    def test_nginx_change_is_validated_then_reloaded(self):
        sha = self.s.commit({"nginx/site.conf": "server { listen 80; }\n"})
        self.assertExit(self.deploy(sha), 0)
        calls = self.stubs.docker_calls()
        t = calls.index(["compose", "exec", "-T", "nginx", "nginx", "-t"])
        self.assertEqual(calls[t + 1], ["compose", "exec", "-T", "nginx", "nginx", "-s", "reload"])

    def test_already_live_commit_is_only_verified(self):
        self.s.fast_forward_server(self.s.base)
        self.assertExit(self.deploy(self.s.base), 0)
        self.assertFalse(has(self.stubs.docker_calls(), "compose", "build"))
        self.assertEqual(self.stubs.smoke_runs(), ["gate"])

    def test_live_commit_failing_verification_fails_without_touching_anything(self):
        self.s.fast_forward_server(self.s.base)
        self.stubs.set("smoke-gate-failures", "-1")
        self.assertExit(self.deploy(self.s.base), 1)
        self.assertEqual(self.stubs.docker_calls(), [])

    def test_superseded_push_does_nothing(self):
        older = self.s.commit({"backend/src/server.ts": "export const v = 1;\n"})
        self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        self.assertExit(self.deploy(older), 0)
        self.assertEqual(self.stubs.docker_calls(), [])
        self.assertEqual(self.s.server_head(), self.s.base)
        self.assertIn("superseded", self.summary())

    def test_manual_rollback_to_an_older_commit(self):
        older = self.s.commit({"backend/src/server.ts": "export const v = 1;\n"})
        newer = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        self.s.fast_forward_server(newer)
        self.assertExit(self.deploy(older, "workflow_dispatch"), 0)
        self.assertEqual(self.s.server_head(), older)
        self.assertIn("rolled production back", self.summary())

    # --- refusals: nothing may move -----------------------------------------

    def test_refusal_touches_nothing(self):
        sha = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        (self.s.server / "backend/src/server.ts").write_text("// edited on the server\n")
        result = self.deploy(sha)
        self.assertExit(result, 3)
        self.assertEqual(self.stubs.docker_calls(), [])
        self.assertEqual(self.s.server_head(), self.s.base)
        self.assertEqual((self.s.server / "backend/src/server.ts").read_text(), "// edited on the server\n")
        self.assertIn("refused", self.summary())

    # --- failures after something moved: roll back ---------------------------

    def assertRolledBack(self, result, previous):
        self.assertExit(result, 1)
        self.assertEqual(self.s.server_head(), previous)
        self.assertFalse(self.last_deployed.exists() and self.last_deployed.read_text().strip() != previous)
        self.assertEqual(self.stubs.sudo_calls(), [], "never prune while a rollback may need the old images")

    def test_build_failure_restores_the_previous_checkout(self):
        sha = self.s.commit({"frontend/src/main.tsx": "syntax error\n"})
        result = self.deploy(sha, STUB_DOCKER_FAIL=r"^compose build")
        self.assertRolledBack(result, self.s.base)
        calls = self.stubs.docker_calls()
        self.assertTrue(has(calls, "tag", "bossclinician-backend:rollback", "bossclinician-backend:latest"))
        self.assertTrue(has(calls, "compose", "up", "-d", "--wait", "--no-build", "backend", "frontend"))
        self.assertIn("previous release is serving again", self.summary())

    def test_container_that_never_goes_healthy_is_rolled_back(self):
        sha = self.s.commit({"backend/src/db/migrations/099_bad.sql": "SELEC 1;\n"})
        result = self.deploy(sha, STUB_DOCKER_FAIL=r"^compose up -d --wait backend$")
        self.assertRolledBack(result, self.s.base)
        self.assertIn("Migrations the failed release applied", self.summary())

    def test_live_api_still_reporting_the_old_release_is_rolled_back(self):
        # e.g. the container was never replaced, or traffic still reaches the old one
        self.stubs.set("release-pinned", "stale-build")
        sha = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        result = self.deploy(sha)
        self.assertRolledBack(result, self.s.base)
        self.assertIn("reports release 'stale-build'", result.stdout)

    def test_smoke_gate_failure_is_rolled_back(self):
        sha = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        self.stubs.set("smoke-gate-failures", "2")  # both attempts after rollout; passes after rollback
        result = self.deploy(sha)
        self.assertRolledBack(result, self.s.base)
        self.assertEqual(self.stubs.smoke_runs(), ["gate", "gate", "gate"])
        self.assertIn("previous release is serving again", self.summary())

    def test_nginx_config_rejected_is_rolled_back_and_old_config_reloaded(self):
        sha = self.s.commit({"nginx/site.conf": "server { BROKEN }\n"})
        result = self.deploy(sha)
        self.assertRolledBack(result, self.s.base)
        self.assertEqual((self.s.server / "nginx/site.conf").read_text(), "server {}\n")
        self.assertIn("previous release is serving again", self.summary())

    def test_failed_rollback_says_so_loudly(self):
        sha = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        self.stubs.set("smoke-gate-failures", "-1")  # never passes
        result = self.deploy(sha)
        self.assertExit(result, 1)
        self.assertIn("ROLLBACK DID NOT RESTORE A HEALTHY SITE", result.stdout + result.stderr)
        self.assertEqual(self.s.server_head(), self.s.base)

    def test_host_checks_failing_after_go_live_fail_the_job_without_rollback(self):
        sha = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        self.stubs.set("smoke-full-fail", "1")
        result = self.deploy(sha)
        self.assertExit(result, 1)
        self.assertEqual(self.s.server_head(), sha)
        self.assertEqual(self.last_deployed.read_text().strip(), sha)
        self.assertFalse(has(self.stubs.docker_calls(), "compose", "up", "-d", "--wait", "--no-build"))

    # --- the generated redirect map ------------------------------------------

    def test_redirects_are_regenerated_from_the_database(self):
        fresh = REDIRECTS_V1.replace("  /old /new;\n", "  /old /new;\n  /admin-added /somewhere;\n")
        self.stubs.set("db-redirects.map", fresh)
        sha = self.s.commit({"README.md": "x\n"})
        self.assertExit(self.deploy(sha), 0)
        self.assertEqual((self.s.server / "nginx/redirects.map").read_text(), fresh)
        reloads = [c for c in self.stubs.docker_calls() if c[-2:] == ["-s", "reload"]]
        self.assertEqual(len(reloads), 2, "once after the rollout, once for the new map")

    def test_redirect_map_differing_only_in_its_header_is_left_alone(self):
        self.stubs.set("db-redirects.map", REDIRECTS_V1.replace("1 rows", "7 rows"))
        sha = self.s.commit({"README.md": "x\n"})
        self.assertExit(self.deploy(sha), 0)
        self.assertEqual((self.s.server / "nginx/redirects.map").read_text(), REDIRECTS_V1)
        reloads = [c for c in self.stubs.docker_calls() if c[-2:] == ["-s", "reload"]]
        self.assertEqual(len(reloads), 1)

    def test_live_regenerated_map_survives_a_rollback(self):
        live = REDIRECTS_V1 + "# regenerated live from the admin's edits\n"
        (self.s.server / "nginx/redirects.map").write_text(live)
        sha = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        result = self.deploy(sha, STUB_DOCKER_FAIL=r"^compose build")
        self.assertRolledBack(result, self.s.base)
        self.assertEqual((self.s.server / "nginx/redirects.map").read_text(), live)

    def test_redirect_generation_failure_only_warns(self):
        sha = self.s.commit({"README.md": "x\n"})  # no db-redirects.map: `compose cp` fails
        result = self.deploy(sha)
        self.assertExit(result, 0)
        self.assertIn("could not regenerate nginx/redirects.map", result.stdout)

    # --- k8s --------------------------------------------------------------------

    def test_k8s_change_is_shown_as_a_diff_and_never_applied(self):
        sha = self.s.commit({"k8s/ingress.yaml": "kind: Ingress\nmetadata: {name: changed}\n"})
        result = self.deploy(sha)
        self.assertExit(result, 0)
        sudo = self.stubs.sudo_calls()
        self.assertIn(["-n", "k3s", "kubectl", "diff", "-f", "k8s/"], sudo)
        self.assertFalse(any("apply" in call for call in sudo))
        self.assertIn("never applies", result.stderr)


if __name__ == "__main__":
    unittest.main()

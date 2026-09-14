"""What a deploy decides, for every edge case the pipeline has to survive.

`classify` maps changed paths to work; `decide` says whether a commit may go to
production at all. Both run against real git repositories.
"""
from __future__ import annotations

import re
import sys
import unittest

from helpers import CI_DIR, REDIRECTS_V1, REPO_ROOT, Scenario

sys.path.insert(0, str(CI_DIR))
import release  # noqa: E402
from release import Refused, classify, decide  # noqa: E402


class ClassifyTests(unittest.TestCase):
    def test_docs_only_change_rebuilds_nothing(self):
        plan = classify(["docs/CI-CD.md", "README.md", "DEPLOY.md", "image.png"])
        self.assertEqual(plan.services, set())
        self.assertFalse(plan.compose_changed or plan.nginx_changed or plan.k8s_changed)

    def test_frontend_change_rebuilds_api_too(self):
        # The API image carries the SSR bundle and names the browser bundle by hash.
        self.assertEqual(classify(["frontend/src/pages/Home.tsx"]).services, {"backend", "frontend"})

    def test_backend_change_rebuilds_only_the_api(self):
        self.assertEqual(classify(["backend/src/routes/public/health.ts"]).services, {"backend"})

    def test_shared_dockerfile_and_dockerignore_rebuild_both_web_images(self):
        self.assertEqual(classify(["backend/Dockerfile"]).services, {"backend", "frontend"})
        self.assertEqual(classify([".dockerignore"]).services, {"backend", "frontend"})

    def test_ai_runtime_files_rebuild_ai_but_its_tests_do_not(self):
        self.assertEqual(classify(["ai/app/main.py"]).services, {"ai"})
        self.assertEqual(classify(["ai/requirements.txt"]).services, {"ai"})
        self.assertEqual(classify(["ai/knowledge/site.md"]).services, {"ai"})
        self.assertEqual(classify(["ai/tests/test_api.py", "ai/README.md", "ai/build_kb.py"]).services, set())

    def test_compose_change_reconciles_everything(self):
        plan = classify(["docker-compose.yml"])
        self.assertTrue(plan.compose_changed)
        self.assertEqual(plan.services, {"ai", "backend", "frontend"})

    def test_nginx_change_reloads_without_rebuilding(self):
        plan = classify(["nginx/site.conf"])
        self.assertTrue(plan.nginx_changed)
        self.assertEqual(plan.services, set())

    def test_migration_rebuilds_api_and_is_flagged(self):
        plan = classify(["backend/src/db/migrations/052_new.sql"])
        self.assertEqual(plan.services, {"backend"})
        self.assertTrue(plan.migrations_changed)
        self.assertTrue(classify(["backend/src/db/schema.sql"]).migrations_changed)

    def test_k8s_change_is_flagged_never_applied(self):
        plan = classify(["k8s/ingress.yaml"])
        self.assertTrue(plan.k8s_changed)
        self.assertEqual(plan.services, set())
        self.assertTrue(any("never applies" in n for n in plan.notes))

    def test_pipeline_and_scripts_changes_rebuild_nothing(self):
        plan = classify([".github/workflows/deploy.yml", "scripts/ci/release.py", "scripts/smoke-test.sh"])
        self.assertEqual(plan.services, set())

    def test_env_example_warns_and_does_not_rebuild(self):
        plan = classify(["backend/.env.example"])
        self.assertEqual(plan.services, set())
        self.assertTrue(any("backend/.env.example" in n for n in plan.notes))

    def test_shared_content_reminds_about_the_knowledge_base(self):
        plan = classify(["shared/content.json"])
        self.assertEqual(plan.services, set())
        self.assertTrue(any("build_kb.py" in n for n in plan.notes))

    def test_force_rebuild_builds_and_reconciles_every_service(self):
        plan = classify([], force_rebuild=True)
        self.assertEqual(plan.services, {"ai", "backend", "frontend"})
        self.assertTrue(plan.compose_changed, "a server .env edit must reach coturn and nginx too")

    def test_deleted_file_counts_like_a_changed_one(self):
        # `git diff --name-only --no-renames` lists a deleted path by its name.
        self.assertEqual(classify(["frontend/src/old.tsx"]).services, {"backend", "frontend"})


class ClassifierMatchesDockerfiles(unittest.TestCase):
    """If a Dockerfile starts copying from somewhere new, the rules above go stale
    silently: a change there would deploy without rebuilding. Fail instead."""

    @staticmethod
    def copy_sources(dockerfile):
        sources = []
        for line in dockerfile.read_text().splitlines():
            parts = line.split()
            if not parts or parts[0] != "COPY" or any(p.startswith("--from") for p in parts):
                continue
            sources.extend(p for p in parts[1:-1] if not p.startswith("--"))
        return sources

    def test_web_dockerfile_copies_only_from_frontend_and_backend(self):
        for source in self.copy_sources(REPO_ROOT / "backend" / "Dockerfile"):
            self.assertRegex(source, r"^(frontend|backend)/", f"classify() does not know about {source}")

    def test_ai_dockerfile_copies_only_what_classify_watches(self):
        for source in self.copy_sources(REPO_ROOT / "ai" / "Dockerfile"):
            self.assertIn(source.rstrip("/"), {"requirements.txt", "app", "knowledge"})


class DecideTests(unittest.TestCase):
    def setUp(self):
        self.s = Scenario()
        self.addCleanup(self.s.cleanup)

    def decide(self, target, event="push", **kw):
        kw.setdefault("min_free_gb", 0)
        return decide(self.s.server, target, event, **kw)

    def assertRefused(self, pattern, target, event="push", **kw):
        with self.assertRaises(Refused) as ctx:
            self.decide(target, event, **kw)
        self.assertRegex(str(ctx.exception), pattern)

    # --- the normal paths -------------------------------------------------

    def test_new_commit_on_main_deploys_with_a_plan(self):
        sha = self.s.commit({"backend/src/server.ts": "export const x = 1;\n"})
        d = self.decide(sha)
        self.assertEqual(d.action, "deploy")
        self.assertEqual(d.plan.services, {"backend"})
        self.assertFalse(d.rollback)

    def test_several_commits_in_one_push_are_planned_together(self):
        self.s.commit({"ai/app/main.py": "x = 1\n"}, push=False)
        sha = self.s.commit({"nginx/site.conf": "server { }\n"})
        d = self.decide(sha)
        self.assertEqual(d.plan.services, {"ai"})
        self.assertTrue(d.plan.nginx_changed)

    def test_commit_already_live_is_verified_not_redeployed(self):
        self.assertEqual(self.decide(self.s.base).action, "verify")

    def test_force_rebuild_of_live_commit_rebuilds_everything(self):
        d = self.decide(self.s.base, "workflow_dispatch", force_rebuild=True)
        self.assertEqual(d.action, "deploy")
        self.assertEqual(d.plan.services, {"ai", "backend", "frontend"})

    # --- ordering: never let an older run overwrite a newer one -------------

    def test_push_superseded_by_a_newer_push_is_skipped(self):
        older = self.s.commit({"README.md": "1\n"})
        self.s.commit({"README.md": "2\n"})
        d = self.decide(older)
        self.assertEqual(d.action, "skip")
        self.assertIn("superseded", d.reason)

    def test_late_run_for_an_older_commit_does_not_roll_production_back(self):
        older = self.s.commit({"README.md": "1\n"})
        newer = self.s.commit({"README.md": "2\n"})
        self.s.fast_forward_server(newer)
        self.assertEqual(self.decide(older).action, "skip")

    def test_manual_dispatch_of_an_older_commit_is_a_rollback(self):
        older = self.s.commit({"backend/src/server.ts": "export const v = 1;\n"})
        newer = self.s.commit({"backend/src/server.ts": "export const v = 2;\n"})
        self.s.fast_forward_server(newer)
        d = self.decide(older, "workflow_dispatch")
        self.assertEqual(d.action, "deploy")
        self.assertTrue(d.rollback)
        self.assertEqual(d.plan.services, {"backend"})
        self.assertTrue(any("rollback" in w for w in d.warnings))

    def test_force_pushed_main_deploys_over_the_rewritten_history(self):
        doomed = self.s.commit({"README.md": "doomed\n"})
        self.s.fast_forward_server(doomed)
        self.s.git(self.s.dev, "reset", "-q", "--hard", self.s.base)
        rewritten = self.s.commit({"README.md": "rewritten\n"}, force=True)
        d = self.decide(rewritten)
        self.assertEqual(d.action, "deploy")

    def test_main_force_pushed_back_to_an_older_commit_deploys_it(self):
        newer = self.s.commit({"README.md": "newer\n"})
        self.s.fast_forward_server(newer)
        self.s.git(self.s.dev, "reset", "-q", "--hard", self.s.base)
        self.s.git(self.s.dev, "push", "-q", "--force", "origin", "HEAD:main")
        d = self.decide(self.s.base)
        self.assertEqual(d.action, "deploy")
        self.assertTrue(d.rollback)

    # --- what may not be deployed ------------------------------------------

    def test_commit_only_on_a_feature_branch_is_refused(self):
        self.s.git(self.s.dev, "checkout", "-q", "-b", "feature")
        sha = self.s.commit({"README.md": "feature\n"}, push=False)
        self.s.git(self.s.dev, "push", "-q", "origin", "feature")
        self.assertRefused("not on origin/main", sha, "workflow_dispatch")

    def test_unknown_commit_is_refused(self):
        self.assertRefused("not a commit", "0123456789abcdef0123456789abcdef01234567")

    def test_other_triggers_are_refused(self):
        sha = self.s.commit({"README.md": "x\n"})
        for event in ("pull_request", "pull_request_target", "workflow_run", "schedule"):
            self.assertRefused("does not deploy", sha, event)

    # --- the server's checkout ---------------------------------------------

    def test_hand_edit_on_the_server_is_refused_and_named(self):
        sha = self.s.commit({"backend/src/server.ts": "export const y = 2;\n"})
        (self.s.server / "backend/src/server.ts").write_text("// hotfix on the box\n")
        self.assertRefused(r"uncommitted edits.*backend/src/server\.ts", sha)

    def test_staged_edit_on_the_server_is_refused(self):
        sha = self.s.commit({"README.md": "x\n"})
        (self.s.server / "docs/notes.md").write_text("staged\n")
        self.s.git(self.s.server, "add", "docs/notes.md")
        self.assertRefused(r"docs/notes\.md", sha)

    def test_regenerated_redirect_map_is_not_a_hand_edit(self):
        sha = self.s.commit({"README.md": "x\n"})
        (self.s.server / "nginx/redirects.map").write_text(REDIRECTS_V1 + "# regenerated\n")
        self.assertEqual(self.decide(sha).action, "deploy")

    def test_commit_made_on_the_server_and_never_pushed_is_refused(self):
        sha = self.s.commit({"README.md": "x\n"})
        (self.s.server / "docs/local.md").write_text("local\n")
        self.s.git(self.s.server, "add", "docs/local.md")
        self.s.git(self.s.server, "commit", "-q", "-m", "made on the server")
        self.assertRefused("exist only on this server", sha)

    def test_untracked_file_in_the_way_of_the_checkout_is_refused(self):
        sha = self.s.commit({"backend/src/new.ts": "export {};\n"})
        (self.s.server / "backend/src/new.ts").write_text("someone's copy\n")
        self.assertRefused(r"untracked.*backend/src/new\.ts", sha)

    def test_ignored_file_in_the_way_is_refused_too(self):
        # A .env someone force-added in a commit would land on top of the live one.
        sha = self.s.commit({"backend/.env": "JWT_SECRET=committed\n"}, add_ignored=True)
        self.assertRefused(r"backend/\.env", sha)
        self.assertEqual((self.s.server / "backend/.env").read_text(), "JWT_SECRET=secret\n")

    def test_server_on_a_detached_head_still_deploys(self):
        sha = self.s.commit({"README.md": "x\n"})
        self.s.git(self.s.server, "checkout", "-q", "--detach", self.s.base)
        self.assertEqual(self.decide(sha).action, "deploy")

    # --- the server's configuration ----------------------------------------

    def test_missing_root_env_is_refused(self):
        sha = self.s.commit({"README.md": "x\n"})
        (self.s.server / ".env").unlink()
        self.assertRefused(r"\.env is missing", sha)

    def test_blank_required_value_is_refused(self):
        sha = self.s.commit({"README.md": "x\n"})
        (self.s.server / ".env").write_text("DB_PASSWORD=\nTURN_HOST=h\nTURN_PORT=1\nTURN_STATIC_AUTH_SECRET=s\n")
        self.assertRefused("DB_PASSWORD, VITE_STRIPE_PUBLISHABLE_KEY", sha)

    def test_missing_backend_secret_is_refused(self):
        sha = self.s.commit({"README.md": "x\n"})
        (self.s.server / "backend/.env").write_text("# empty\n")
        self.assertRefused("JWT_SECRET", sha)

    def test_missing_ai_env_file_is_refused(self):
        sha = self.s.commit({"README.md": "x\n"})
        (self.s.server / "ai/.env").unlink()
        self.assertRefused(r"ai/\.env is missing", sha)

    def test_new_variable_in_an_example_warns_when_the_server_lacks_it(self):
        sha = self.s.commit({"backend/.env.example": "JWT_SECRET=\nNEW_PROVIDER_KEY=\n"})
        d = self.decide(sha)
        self.assertEqual(d.action, "deploy")
        self.assertTrue(any("NEW_PROVIDER_KEY" in w for w in d.warnings))

    def test_new_variable_already_set_on_the_server_does_not_warn(self):
        sha = self.s.commit({"backend/.env.example": "JWT_SECRET=\nNEW_PROVIDER_KEY=\n"})
        (self.s.server / "backend/.env").write_text("JWT_SECRET=s\nNEW_PROVIDER_KEY=k\n")
        self.assertFalse(any("NEW_PROVIDER_KEY" in w for w in self.decide(sha).warnings))

    def test_low_disk_is_refused_before_anything_moves(self):
        sha = self.s.commit({"README.md": "x\n"})
        self.assertRefused("GiB free", sha, min_free_gb=10**9)
        self.assertEqual(self.s.server_head(), self.s.base)


class FetchAuthTests(unittest.TestCase):
    """The production runner has no GitHub credential of its own; the first live
    deploy was refused on `git fetch` for exactly that. The job's token is how it
    fetches now."""

    def test_token_becomes_an_extraheader_via_environment_config(self):
        import base64

        env = release.fetch_env({"GIT_FETCH_TOKEN": "ghs_example", "PATH": "/bin"})
        self.assertNotIn("GIT_FETCH_TOKEN", env, "the raw token must not be passed on")
        self.assertEqual(env["GIT_CONFIG_COUNT"], "1")
        self.assertEqual(env["GIT_CONFIG_KEY_0"], "http.https://github.com/.extraheader")
        scheme, _, encoded = env["GIT_CONFIG_VALUE_0"].partition("basic ")
        self.assertEqual(scheme, "AUTHORIZATION: ")
        self.assertEqual(base64.b64decode(encoded).decode(), "x-access-token:ghs_example")
        self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")

    def test_existing_environment_config_is_appended_to_not_replaced(self):
        env = release.fetch_env({
            "GIT_FETCH_TOKEN": "t", "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.autocrlf", "GIT_CONFIG_VALUE_0": "false",
        })
        self.assertEqual(env["GIT_CONFIG_COUNT"], "2")
        self.assertEqual(env["GIT_CONFIG_KEY_0"], "core.autocrlf")
        self.assertEqual(env["GIT_CONFIG_KEY_1"], "http.https://github.com/.extraheader")

    def test_without_a_token_git_never_prompts(self):
        env = release.fetch_env({"PATH": "/bin"})
        self.assertNotIn("GIT_CONFIG_COUNT", env)
        self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")

    def test_decide_still_fetches_with_a_token_set(self):
        from unittest import mock

        s = Scenario()
        self.addCleanup(s.cleanup)
        sha = s.commit({"README.md": "fetched with a token\n"})
        with mock.patch.dict("os.environ", {"GIT_FETCH_TOKEN": "ghs_example"}):
            self.assertEqual(decide(s.server, sha, "push", min_free_gb=0).action, "deploy")


class EmitTests(unittest.TestCase):
    def test_output_is_safe_to_source_in_bash(self):
        import io
        import subprocess

        decision = release.Decision(
            "deploy", "it's $(rm -rf /) `quoted`; fine", "a" * 40, "b" * 40, "b" * 40,
            plan=release.Plan(services={"backend", "frontend"}),
        )
        out = io.StringIO()
        release.emit(decision, out=out, err=io.StringIO())
        script = out.getvalue() + 'printf "%s|%s|%s" "$ACTION" "$SERVICES" "$REASON"'
        result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout, "deploy|backend frontend|it's $(rm -rf /) `quoted`; fine")

    def test_cli_exit_code_is_3_on_refusal(self):
        s = Scenario()
        self.addCleanup(s.cleanup)
        (s.server / ".env").unlink()
        sha = s.commit({"README.md": "x\n"})
        import subprocess

        result = subprocess.run(
            [sys.executable, str(CI_DIR / "release.py"), "check", "--repo", str(s.server), "--target", sha,
             "--event", "push", "--min-free-gb", "0"],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 3)
        self.assertTrue(re.search(r"::error::Deploy refused", result.stderr))
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()

"""Contract tests for the GitHub workflows.

actionlint proves the files are valid. These prove they still mean what the
pipeline depends on: nothing untested deploys, nothing but main deploys, and
nothing but the deploy job ever runs on the production host.
"""
from __future__ import annotations

import re
import unittest

import yaml

from helpers import REPO_ROOT

WORKFLOWS = REPO_ROOT / ".github" / "workflows"


class _Loader(yaml.SafeLoader):
    pass


# Compose's merge tags, which PyYAML does not know.
_Loader.add_constructor("!override", lambda loader, node: loader.construct_sequence(node))
_Loader.add_constructor("!reset", lambda loader, node: None)


def load(path):
    data = yaml.load(path.read_text(), Loader=_Loader)
    # YAML 1.1 reads the bare key `on` as the boolean True.
    if True in data:
        data["on"] = data.pop(True)
    return data


def runs_on(job) -> list[str]:
    value = job.get("runs-on", [])
    return [value] if isinstance(value, str) else list(value)


def steps(job):
    return job.get("steps", [])


class WorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ci = load(WORKFLOWS / "ci.yml")
        cls.deploy = load(WORKFLOWS / "deploy.yml")

    # --- the production host -------------------------------------------------

    def test_only_the_deploy_job_runs_on_the_production_host(self):
        self_hosted = set()
        for path in sorted(WORKFLOWS.glob("*.y*ml")):
            for name, job in load(path).get("jobs", {}).items():
                if "self-hosted" in runs_on(job) or "bossclinician" in runs_on(job):
                    self_hosted.add((path.name, name))
        self.assertEqual(self_hosted, {("deploy.yml", "deploy")})

    def test_no_workflow_runs_untrusted_code_with_elevated_triggers(self):
        for path in sorted(WORKFLOWS.glob("*.y*ml")):
            triggers = load(path)["on"]
            names = set(triggers) if isinstance(triggers, (dict, list)) else {triggers}
            self.assertFalse(names & {"pull_request_target", "workflow_run"}, path.name)

    # --- CI -------------------------------------------------------------------

    def test_ci_runs_for_pull_requests_other_branches_and_deploys(self):
        on = self.ci["on"]
        self.assertIn("pull_request", on)
        self.assertEqual(on["push"]["branches-ignore"], ["main"])
        self.assertIn("ref", on["workflow_call"]["inputs"])

    def test_ci_keeps_every_suite(self):
        self.assertTrue({"pipeline", "backend", "frontend", "ai", "stack"} <= set(self.ci["jobs"]))

    def test_every_ci_checkout_tests_the_requested_commit(self):
        self.assertEqual(self.ci["env"]["CHECKOUT_REF"], "${{ inputs.ref || github.sha }}")
        for name, job in self.ci["jobs"].items():
            checkouts = [s for s in steps(job) if str(s.get("uses", "")).startswith("actions/checkout@")]
            self.assertTrue(checkouts, f"{name} never checks out the code")
            for step in checkouts:
                self.assertEqual(step.get("with", {}).get("ref"), "${{ env.CHECKOUT_REF }}", name)

    def test_backend_integration_tests_have_a_database(self):
        job = self.ci["jobs"]["backend"]
        self.assertIn("postgres", job["services"])
        integration = [s for s in steps(job) if "integration" in s.get("name", "").lower()]
        self.assertEqual(len(integration), 1)
        self.assertIn("TEST_DATABASE_URL", integration[0]["env"])

    def test_stack_job_checks_the_release_it_built(self):
        job = self.ci["jobs"]["stack"]
        self.assertEqual(job["env"]["APP_RELEASE"], "${{ inputs.ref || github.sha }}")
        self.assertTrue(any("/api/health" in s.get("run", "") for s in steps(job)))

    # --- Deploy ------------------------------------------------------------------

    def test_deploy_triggers_only_on_main_and_manual_dispatch(self):
        on = self.deploy["on"]
        self.assertEqual(set(on), {"push", "workflow_dispatch"})
        self.assertEqual(on["push"], {"branches": ["main"]})

    def test_ci_tests_the_exact_commit_the_deploy_ships(self):
        jobs = self.deploy["jobs"]
        self.assertEqual(jobs["ci"]["uses"], "./.github/workflows/ci.yml")
        self.assertEqual(jobs["ci"]["with"]["ref"], "${{ needs.resolve.outputs.sha }}")
        deploy_step = next(s for s in steps(jobs["deploy"]) if "deploy-release.sh" in s.get("run", ""))
        self.assertEqual(deploy_step["env"]["TARGET_SHA"], "${{ needs.resolve.outputs.sha }}")

    def test_server_fetches_with_the_jobs_own_short_lived_token(self):
        deploy_step = next(s for s in steps(self.deploy["jobs"]["deploy"]) if "deploy-release.sh" in s.get("run", ""))
        self.assertEqual(deploy_step["env"]["GIT_FETCH_TOKEN"], "${{ github.token }}")
        self.assertNotIn("secrets.", str(deploy_step["env"]), "no long-lived secret should reach the server")

    def test_deploy_job_waits_for_ci_and_is_main_only(self):
        job = self.deploy["jobs"]["deploy"]
        self.assertTrue({"ci", "resolve"} <= set(job["needs"]))
        self.assertIn("refs/heads/main", job["if"])
        # A status function in `if` would replace the implicit success() and let
        # the deploy run after a failed CI.
        self.assertNotRegex(job["if"], r"\b(always|failure|cancelled)\(\)")
        self.assertEqual(runs_on(job), ["self-hosted", "bossclinician"])
        self.assertIn("timeout-minutes", job)

    def test_deploys_queue_and_are_never_cancelled_midway(self):
        concurrency = self.deploy["jobs"]["deploy"]["concurrency"]
        self.assertEqual(concurrency["group"], "production")
        self.assertIs(concurrency["cancel-in-progress"], False)

    def test_resolve_refuses_commits_not_on_main(self):
        script = next(s["run"] for s in steps(self.deploy["jobs"]["resolve"]) if "run" in s)
        self.assertIn("merge-base --is-ancestor", script)
        self.assertIn("refs/heads/main", self.deploy["jobs"]["resolve"]["if"])

    # --- both ---------------------------------------------------------------------

    def test_token_permissions_are_read_only(self):
        for wf in (self.ci, self.deploy):
            self.assertEqual(wf["permissions"], {"contents": "read"})
            for job in wf["jobs"].values():
                for scope, level in (job.get("permissions") or {}).items():
                    self.assertNotEqual(level, "write", scope)

    def test_actions_are_pinned_to_a_release(self):
        pinned = re.compile(r"^[\w.-]+/[\w.-]+(/[\w./-]+)?@(v\d+(\.\d+){0,2}|[0-9a-f]{40})$")
        for path in sorted(WORKFLOWS.glob("*.y*ml")):
            for job in load(path)["jobs"].values():
                uses = [job["uses"]] if "uses" in job else [s["uses"] for s in steps(job) if "uses" in s]
                for ref in uses:
                    if not ref.startswith("./"):
                        self.assertRegex(ref, pinned, f"{path.name}: {ref}")


class ComposeContractTests(unittest.TestCase):
    def test_ci_override_binds_nginx_to_loopback_not_the_k3s_gateway(self):
        override = load(REPO_ROOT / ".github/ci/docker-compose.ci.yml")
        self.assertEqual(override["services"]["nginx"]["ports"], ["127.0.0.1:8088:80"])

    def test_both_web_images_receive_the_release(self):
        compose = load(REPO_ROOT / "docker-compose.yml")
        for service in ("backend", "frontend"):
            self.assertEqual(compose["services"][service]["build"]["args"]["APP_RELEASE"], "${APP_RELEASE:-dev}")
        dockerfile = (REPO_ROOT / "backend/Dockerfile").read_text()
        api_stage = dockerfile.split("AS api", 1)[1].split("\nFROM ", 1)[0]
        self.assertIn("ARG APP_RELEASE", api_stage)
        self.assertIn("ENV APP_RELEASE", api_stage)

    def test_production_nginx_binding_matches_the_k8s_endpoint(self):
        # DEPLOY.md: these two move together, or every request is a silent 502.
        compose = load(REPO_ROOT / "docker-compose.yml")
        host_ip = compose["services"]["nginx"]["ports"][0].split(":")[0]
        self.assertIn(f"ip: {host_ip}", (REPO_ROOT / "k8s/ingress.yaml").read_text())


if __name__ == "__main__":
    unittest.main()

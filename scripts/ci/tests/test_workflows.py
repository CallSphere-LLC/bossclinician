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
        self.assertEqual(self_hosted, set())

    def test_no_workflow_runs_untrusted_code_with_elevated_triggers(self):
        for path in sorted(WORKFLOWS.glob("*.y*ml")):
            triggers = load(path)["on"]
            names = set(triggers) if isinstance(triggers, (dict, list)) else {triggers}
            self.assertFalse(names & {"pull_request_target", "workflow_run"}, path.name)

    # --- CI -------------------------------------------------------------------

    def test_ci_runs_for_pull_requests_other_branches_and_deploys(self):
        on = self.ci["on"]
        self.assertIn("pull_request", on)
        # Dependabot branches get CI from their pull request only, never twice.
        self.assertEqual(on["push"]["branches-ignore"], ["dependabot/**"])
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

    def test_deploy_workflow_has_no_automatic_trigger(self):
        self.assertEqual(set(self.deploy["on"]), {"workflow_dispatch"})

    def test_no_workflow_can_deploy_to_production(self):
        for path in sorted(WORKFLOWS.glob("*.y*ml")):
            for job in load(path).get("jobs", {}).values():
                self.assertNotIn("self-hosted", runs_on(job))
                for step in steps(job):
                    command = step.get("run", "")
                    self.assertNotIn("scripts/ci/deploy-release.sh", command)
                    self.assertNotIn("kubectl apply", command)
                    self.assertNotIn("k3s-cutover.sh", command)

    # --- both ---------------------------------------------------------------------

    def test_token_permissions_are_read_only(self):
        # The one exception: the deploy job may mint an OIDC token and store an
        # attestation for the images it deployed. Nothing may write contents.
        allowed_writes = {("deploy", "id-token"), ("deploy", "attestations")}
        for wf in (self.ci, self.deploy):
            self.assertEqual(wf["permissions"], {"contents": "read"})
            for name, job in wf["jobs"].items():
                for scope, level in (job.get("permissions") or {}).items():
                    if level == "write":
                        self.assertIn((name, scope), allowed_writes)

    def test_actions_are_pinned_to_a_full_commit_sha(self):
        # The repository requires SHA pinning (Actions settings); a tag here would
        # make the workflow fail to start rather than run an unexpected version.
        pinned = re.compile(r"^[\w.-]+/[\w.-]+(/[\w./-]+)?@[0-9a-f]{40}$")
        for path in sorted(WORKFLOWS.glob("*.y*ml")):
            for job in load(path)["jobs"].values():
                uses = [job["uses"]] if "uses" in job else [s["uses"] for s in steps(job) if "uses" in s]
                for ref in uses:
                    if not ref.startswith("./"):
                        self.assertRegex(ref, pinned, f"{path.name}: {ref}")

    def test_dependency_review_runs_only_on_pull_requests(self):
        job = self.ci["jobs"]["dependency-review"]
        self.assertEqual(job["if"], "github.event_name == 'pull_request'")
        self.assertTrue(any(str(s.get("uses", "")).startswith("actions/dependency-review-action@") for s in steps(job)))



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

    def test_production_ingress_uses_native_app_selector(self):
        ingress = (REPO_ROOT / "k8s/ingress.yaml").read_text()
        docs = list(yaml.safe_load_all(ingress))
        service = next(d for d in docs if d["kind"] == "Service")
        self.assertEqual(service["spec"]["selector"], {"app": "boss-app"})
        self.assertEqual(service["spec"]["ports"][0]["targetPort"], 8080)
        self.assertFalse(any(d["kind"] == "Endpoints" for d in docs))


if __name__ == "__main__":
    unittest.main()

"""The release identity belongs to the immutable image, never a runtime secret."""
import contextlib
import io
import json
import runpy
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from helpers import REPO_ROOT


class ReleaseIdentityTests(unittest.TestCase):
    def render(self, inherited_release):
        backend = {
            "DATABASE_URL": "postgres://synthetic:fixture@db:5432/boss",
            "SMTP_PASS": "synthetic-fixture-only",
            "AI_BASE_URL": "http://ai:8000",
        }
        if inherited_release is not None:
            backend["APP_RELEASE"] = inherited_release
        ai = {"MODEL": "fixture-model", "API_TOKEN": "synthetic-token-only"}
        secrets = []

        def run(command, **kwargs):
            if command[:4] == ("sudo", "-n", "kubectl", "get"):
                output = "fixture-node"
            elif command[:3] == ("docker", "compose", "config"):
                output = json.dumps({"services": {"backend": {"environment": backend}, "ai": {"environment": ai}}})
            elif command[:3] == ("docker", "volume", "inspect"):
                output = "/fixture/" + command[3]
            elif command[:4] == ("sudo", "-n", "kubectl", "apply"):
                obj = json.loads(kwargs["input"])
                if obj["kind"] == "Secret":
                    secrets.append(obj)
                output = ""
            else:
                raise AssertionError(command)
            return types.SimpleNamespace(stdout=output)

        original_read = Path.read_text
        def read(path, *args, **kwargs):
            if path.as_posix() == "/etc/bossclinician/pg-ca/ca.crt":
                return "synthetic-ca"
            return original_read(path, *args, **kwargs)

        media = types.SimpleNamespace(load=lambda: None, configure_backend=lambda *args: None)
        with patch.dict(sys.modules, {"media_storage_release": media}), patch("subprocess.run", side_effect=run), patch.object(Path, "read_text", read), patch("sys.argv", ["render", "new-image-release"]), contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(REPO_ROOT / "scripts/deploy-k3s-render.py"), run_name="__main__")
        return backend, ai, secrets

    def test_secret_never_overrides_image_release_and_preserves_credentials(self):
        for inherited in (None, "old-runtime-release"):
            with self.subTest(inherited=inherited):
                backend, ai, secrets = self.render(inherited)
                env = next(s["stringData"] for s in secrets if s["metadata"]["name"].startswith("boss-backend-"))
                self.assertNotIn("APP_RELEASE", env)
                self.assertEqual(env["DATABASE_URL"], "postgres://synthetic:fixture@10.42.0.1:15432/boss?sslmode=verify-full&sslrootcert=%2Fetc%2Fbossclinician%2Fpg-ca%2Fca.crt")
                for name, value in backend.items():
                    if name not in ("DATABASE_URL", "APP_RELEASE"):
                        self.assertEqual(env[name], value)
                self.assertEqual(next(s["stringData"] for s in secrets if s["metadata"]["name"].startswith("boss-ai-")), ai)

    def test_image_build_still_bakes_release_identity(self):
        script = (REPO_ROOT / "scripts/deploy-k3s.sh").read_text()
        dockerfile = (REPO_ROOT / "backend/Dockerfile").read_text()
        self.assertIn('--build-arg "APP_RELEASE=$release"', script)
        self.assertIn("ARG APP_RELEASE=dev", dockerfile)
        self.assertIn("ENV APP_RELEASE=${APP_RELEASE}", dockerfile)

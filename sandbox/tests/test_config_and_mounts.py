"""Unit tests for BrokerConfig validation, workspaces, and Skill mounts."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sandbox_broker import BrokerError, validate_request
from tests.helpers import TEST_TOKEN, make_broker, make_payload


class ConfigAndMountTests(unittest.TestCase):
    def test_workspace_path_is_stable_and_scoped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            broker = make_broker(root)
            first = broker.workspace_path(3)
            second = broker.workspace_path(3)
            self.assertEqual(first, second)
            self.assertEqual(first.parent, root.resolve())

    def test_personal_skill_mount_is_owner_scoped_and_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            broker = make_broker(
                root,
                workspace_root=root / "workspaces",
                docker_workspace_root=root / "workspaces",
                global_skills_root=root / "global",
                docker_global_skills_root=root / "docker-global",
                image="runner",
                network="none",
            )
            revision = "a" * 64
            package = root / "global" / ".personal" / "7" / "9" / "revisions" / revision
            package.mkdir(parents=True)
            skill = {
                "scope": "personal",
                "ownerId": 7,
                "id": 9,
                "name": "personal-9",
                "revision": revision,
            }
            request = validate_request(make_payload(extra={"skill": skill}), TEST_TOKEN)
            workdir, mounts = broker.skill_runtime(request, root / "workspaces" / "12")
            self.assertEqual(workdir, "/skills/personal-9")
            self.assertEqual(
                mounts,
                [
                    "--mount",
                    f"type=bind,src={root}/docker-global/.personal/7/9/revisions/{revision},dst=/skills/personal-9,readonly",
                ],
            )

            assert request["skill"] is not None
            request["skill"]["ownerId"] = 8
            with self.assertRaises(BrokerError):
                broker.skill_runtime(request, root / "workspaces" / "12")

    def test_personal_skill_cannot_escape_through_an_owner_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            broker = make_broker(
                root,
                workspace_root=root / "workspaces",
                docker_workspace_root=root / "workspaces",
                global_skills_root=root / "global",
                docker_global_skills_root=root / "global",
                image="runner",
                network="none",
            )
            outside = root / "outside"
            (outside / "9" / "revisions" / ("a" * 64)).mkdir(parents=True)
            (root / "global" / ".personal").mkdir(parents=True)
            (root / "global" / ".personal" / "7").symlink_to(
                outside, target_is_directory=True
            )
            request = validate_request(
                make_payload(
                    extra={
                        "skill": {
                            "scope": "personal",
                            "ownerId": 7,
                            "id": 9,
                            "name": "personal-9",
                            "revision": "a" * 64,
                        }
                    }
                ),
                TEST_TOKEN,
            )
            with self.assertRaises(BrokerError):
                broker.skill_runtime(request, root / "workspaces" / "12")

    def test_validates_and_mounts_global_skill_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            revision = "b" * 64
            skill_root = root / "global-skills" / "7" / "revisions" / revision
            skill_root.mkdir(parents=True)
            (skill_root / "SKILL.md").write_text(
                "---\nname: demo\ndescription: demo\n---\n",
                encoding="utf-8",
            )
            broker = make_broker(
                root,
                workspace_root=root / "workspaces",
                docker_workspace_root=root / "workspaces",
            )
            request = validate_request(
                make_payload(
                    timeout_seconds=1800,
                    extra={
                        "skill": {
                            "id": 7,
                            "name": "demo",
                            "scope": "global",
                            "revision": revision,
                        }
                    },
                ),
                TEST_TOKEN,
            )
            command, _ = broker.docker_command(
                request, broker.workspace_path(request["workspace_id"])
            )
            self.assertEqual(request["timeout_seconds"], 1800)
            self.assertIn("/skills/demo", command)
            self.assertTrue(
                any("dst=/skills/demo,readonly" in value for value in command)
            )

    def test_runner_mounts_trusted_ca_and_bypass_without_disabling_tls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ca = root / "ca.pem"
            ca.write_text("test certificate", encoding="utf-8")
            with patch("sandbox_broker.config.ssl.create_default_context") as trust:
                broker = make_broker(
                    root,
                    global_skills_root=root,
                    docker_global_skills_root=root,
                    image="runner",
                    proxy_url="http://proxy:8080",
                    ca_bundle=ca,
                    docker_ca_bundle=Path("/host/ca.pem"),
                    no_proxy="localhost,internal",
                )
            trust.assert_called_once_with(cafile=str(ca))
            request = validate_request(make_payload(), TEST_TOKEN)
            command, _ = broker.docker_command(request, broker.workspace_path(12))
            self.assertIn(
                "type=bind,src=/host/ca.pem,dst=/etc/coregenie/ca-bundle.pem,readonly",
                command,
            )
            for key in (
                "REQUESTS_CA_BUNDLE",
                "SSL_CERT_FILE",
                "CURL_CA_BUNDLE",
                "NODE_EXTRA_CA_CERTS",
                "GIT_SSL_CAINFO",
                "PIP_CERT",
            ):
                self.assertIn(f"{key}=/etc/coregenie/ca-bundle.pem", command)
            self.assertIn("NO_PROXY=localhost,internal", command)
            self.assertNotIn("NODE_TLS_REJECT_UNAUTHORIZED=0", command)

    def test_invalid_ca_fails_before_any_runner_is_created(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ca = root / "ca.pem"
            ca.write_text("not a certificate", encoding="utf-8")

            with self.assertRaises(BrokerError):
                make_broker(root, ca_bundle=ca)
            with self.assertRaises(BrokerError):
                make_broker(root, ca_bundle=ca, docker_ca_bundle=Path("relative.pem"))
            with self.assertRaises(BrokerError):
                make_broker(root, ca_bundle=ca, docker_ca_bundle=Path("/host/ca.pem"))
            with self.assertRaises(BrokerError):
                make_broker(root, no_proxy="localhost\ninvalid")

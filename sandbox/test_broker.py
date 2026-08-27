import tempfile
import unittest
import uuid
from pathlib import Path

from sandbox.broker import BrokerError, SandboxBroker, validate_request


class BrokerValidationTests(unittest.TestCase):
    def setUp(self):
        self.token = "a" * 64
        self.payload = {
            "token": self.token,
            "language": "python",
            "code": "print('ok')",
            "workspaceId": 12,
            "invocationId": str(uuid.uuid4()),
            "timeoutSeconds": 5,
        }

    def test_accepts_narrow_request(self):
        request = validate_request(self.payload, self.token)
        self.assertEqual(request["workspace_id"], 12)
        self.assertEqual(request["language"], "python")

    def test_rejects_bad_identity_and_language(self):
        with self.assertRaises(BrokerError):
            validate_request({**self.payload, "token": "wrong"}, self.token)
        with self.assertRaises(BrokerError):
            validate_request({**self.payload, "language": "sh"}, self.token)
        with self.assertRaises(BrokerError):
            validate_request({**self.payload, "workspaceId": "../../root"}, self.token)

    def test_workspace_path_is_stable_and_scoped(self):
        with tempfile.TemporaryDirectory() as root:
            broker = SandboxBroker(
                token=self.token,
                workspace_root=Path(root),
                docker_workspace_root=Path(root),
                image="anythingllm-sandbox:local",
                docker_binary="docker",
                max_concurrency=1,
                workspace_uid=1000,
                workspace_gid=1000,
                network="bridge",
                proxy_url=None,
            )
            first = broker.workspace_path(3)
            second = broker.workspace_path(3)
            self.assertEqual(first, second)
            self.assertEqual(first.parent, Path(root).resolve())

    def test_runner_uses_configured_network_and_proxy(self):
        with tempfile.TemporaryDirectory() as root:
            broker = SandboxBroker(
                token=self.token,
                workspace_root=Path(root),
                docker_workspace_root=Path(root),
                image="anythingllm-sandbox:local",
                docker_binary="docker",
                max_concurrency=1,
                workspace_uid=1000,
                workspace_gid=1000,
                network="bridge",
                proxy_url="http://172.17.0.1:7890",
            )
            request = validate_request(self.payload, self.token)
            command, _ = broker.docker_command(
                request, broker.workspace_path(request["workspace_id"])
            )
            self.assertEqual(command[command.index("--network") + 1], "bridge")
            self.assertIn("host.docker.internal:host-gateway", command)
            self.assertIn("HTTP_PROXY=http://172.17.0.1:7890", command)
            self.assertIn("HTTPS_PROXY=http://172.17.0.1:7890", command)
            self.assertIn("http_proxy=http://172.17.0.1:7890", command)
            self.assertIn("https_proxy=http://172.17.0.1:7890", command)
            self.assertIn("PYTHONUSERBASE=/workspace/.python", command)
            self.assertIn("PIP_USER=1", command)


if __name__ == "__main__":
    unittest.main()

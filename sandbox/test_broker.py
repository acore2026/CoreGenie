import tempfile
import unittest
import uuid
import subprocess
import threading
import time
from unittest.mock import MagicMock, patch
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


    def test_personal_skill_mount_is_owner_scoped_and_read_only(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            broker = SandboxBroker(
                token=self.token, workspace_root=root / "workspaces",
                docker_workspace_root=root / "workspaces",
                global_skills_root=root / "global",
                docker_global_skills_root=root / "docker-global",
                image="runner", docker_binary="docker", max_concurrency=1,
                workspace_uid=1000, workspace_gid=1000, network="none", proxy_url=None,
            )
            revision = "a" * 64
            package = root / "global" / ".personal" / "7" / "9" / "revisions" / revision
            package.mkdir(parents=True)
            skill = {"scope": "personal", "ownerId": 7, "id": 9,
                     "name": "personal-9", "revision": revision}
            request = validate_request({**self.payload, "skill": skill}, self.token)
            workdir, mounts = broker.skill_runtime(request, root / "workspaces" / "12")
            self.assertEqual(workdir, "/skills/personal-9")
            self.assertEqual(mounts, ["--mount",
                f"type=bind,src={root}/docker-global/.personal/7/9/revisions/{revision},dst=/skills/personal-9,readonly"])
            request["skill"]["ownerId"] = 8
            with self.assertRaises(BrokerError):
                broker.skill_runtime(request, root / "workspaces" / "12")

    def test_personal_skill_rejects_invalid_owner_or_id(self):
        skill = {"scope": "personal", "ownerId": 7, "id": 9,
                 "name": "personal-9", "revision": "a" * 64}
        for key in ("ownerId", "id"):
            for value in (None, 0, -1, "../7", True):
                with self.subTest(key=key, value=value), self.assertRaises(BrokerError):
                    validate_request({**self.payload, "skill": {**skill, key: value}}, self.token)

    def test_personal_skill_cannot_escape_through_an_owner_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            broker = SandboxBroker(
                token=self.token, workspace_root=root / "workspaces",
                docker_workspace_root=root / "workspaces",
                global_skills_root=root / "global",
                docker_global_skills_root=root / "global",
                image="runner", docker_binary="docker", max_concurrency=1,
                workspace_uid=1000, workspace_gid=1000, network="none", proxy_url=None,
            )
            outside = root / "outside"
            (outside / "9" / "revisions" / ("a" * 64)).mkdir(parents=True)
            (root / "global" / ".personal").mkdir(parents=True)
            (root / "global" / ".personal" / "7").symlink_to(outside, target_is_directory=True)
            request = validate_request({**self.payload, "skill": {
                "scope": "personal", "ownerId": 7, "id": 9,
                "name": "personal-9", "revision": "a" * 64}}, self.token)
            with self.assertRaises(BrokerError):
                broker.skill_runtime(request, root / "workspaces" / "12")

    def test_accepts_narrow_request(self):
        request = validate_request(self.payload, self.token)
        self.assertEqual(request["workspace_id"], 12)
        self.assertEqual(request["language"], "python")

    def test_accepts_subagent_call_ids_and_preserves_uuid_ids(self):
        self.assertEqual(validate_request(self.payload, self.token)["invocation_id"],
                         self.payload["invocationId"])
        payload = {**self.payload, "invocationId": "call_feb0e48a2b784f12a0941095"}
        request = validate_request(payload, self.token)
        self.assertEqual(str(uuid.UUID(request["invocation_id"])), request["invocation_id"])
        self.assertEqual(request["invocation_id"], validate_request(payload, self.token)["invocation_id"])
        for invalid in (None, "", "../escape", "bad\nname", "x" * 129):
            with self.subTest(invalid=invalid), self.assertRaises(BrokerError):
                validate_request({**self.payload, "invocationId": invalid}, self.token)

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
                global_skills_root=Path(root) / "global-skills",
                docker_global_skills_root=Path(root) / "global-skills",
                image="anythingllm-sandbox:local",
                docker_binary="docker",
                max_concurrency=1,
                queue_timeout=0,
                workspace_uid=1000,
                workspace_gid=1000,
                network="bridge",
                proxy_url=None,
            )
            first = broker.workspace_path(3)
            second = broker.workspace_path(3)
            self.assertEqual(first, second)
            self.assertEqual(first.parent, Path(root).resolve())

    def test_reports_capacity_pressure_as_retryable(self):
        with tempfile.TemporaryDirectory() as root:
            broker = SandboxBroker(
                token=self.token,
                workspace_root=Path(root),
                docker_workspace_root=Path(root),
                global_skills_root=Path(root) / "global-skills",
                docker_global_skills_root=Path(root) / "global-skills",
                image="anythingllm-sandbox:local",
                docker_binary="docker",
                max_concurrency=1,
                queue_timeout=0,
                workspace_uid=1000,
                workspace_gid=1000,
                network="bridge",
                proxy_url=None,
            )
            self.assertTrue(broker.capacity.acquire(blocking=False))
            try:
                with self.assertRaises(BrokerError) as raised:
                    broker.execute(self.payload)
                self.assertEqual(raised.exception.code, "SANDBOX_BUSY")
                self.assertTrue(raised.exception.retryable)
            finally:
                broker.capacity.release()

    def test_waits_for_capacity_instead_of_failing_a_short_burst(self):
        broker = SandboxBroker.__new__(SandboxBroker)
        broker.token = self.token
        broker.capacity = threading.BoundedSemaphore(1)
        broker.queue_timeout = 1
        broker.capacity.acquire()
        entered = threading.Event()
        errors = []

        def run():
            try:
                broker.execute(self.payload)
            except BrokerError as exc:
                errors.append(str(exc))

        def workspace(_):
            entered.set()
            raise BrokerError("capacity acquired")

        with patch.object(broker, "workspace_path", side_effect=workspace):
            worker = threading.Thread(target=run)
            worker.start()
            self.assertFalse(entered.wait(0.05))
            broker.capacity.release()
            worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(entered.is_set())
        self.assertEqual(errors, ["capacity acquired"])
        self.assertTrue(broker.capacity.acquire(blocking=False))
        broker.capacity.release()

    def test_accepts_long_jobs_and_larger_code(self):
        request = validate_request(
            {**self.payload, "code": "#" * (128 * 1024),
             "timeoutSeconds": 7200, "queueTimeoutSeconds": 120}, self.token
        )
        self.assertEqual(request["timeout_seconds"], 7200)
        self.assertEqual(request["queue_timeout_seconds"], 120)

    def test_timeout_covers_blocked_script_input_and_releases_capacity(self):
        with tempfile.TemporaryDirectory() as root:
            broker = SandboxBroker(
                token=self.token,
                workspace_root=Path(root),
                docker_workspace_root=Path(root),
                global_skills_root=Path(root),
                docker_global_skills_root=Path(root),
                image="test", docker_binary="docker", max_concurrency=1,
                workspace_uid=1000, workspace_gid=1000,
                network="none", proxy_url=None,
            )
            payload = {**self.payload, "language": "bash", "timeoutSeconds": 1,
                       "code": "sleep 30\n#" + "x" * (128 * 1024)}
            started = time.monotonic()
            with patch.object(broker, "docker_command", return_value=(
                ["bash", "--noprofile", "--norc", "-s"], "test-runner"
            )), patch.object(broker, "kill_container") as remove:
                result = broker.execute(payload)
            self.assertTrue(result["timedOut"])
            self.assertLess(time.monotonic() - started, 5)
            remove.assert_called_once_with("test-runner")
            self.assertTrue(broker.capacity.acquire(blocking=False))
            broker.capacity.release()

    def test_runner_uses_configured_network_and_proxy(self):
        with tempfile.TemporaryDirectory() as root:
            broker = SandboxBroker(
                token=self.token,
                workspace_root=Path(root),
                docker_workspace_root=Path(root),
                global_skills_root=Path(root) / "global-skills",
                docker_global_skills_root=Path(root) / "global-skills",
                image="anythingllm-sandbox:local",
                docker_binary="docker",
                max_concurrency=1,
                queue_timeout=0,
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
            self.assertEqual(command[command.index("--memory") + 1], "4g")
            self.assertEqual(command[command.index("--pids-limit") + 1], "512")
            self.assertEqual(command[command.index("--cpus") + 1], "2")
            self.assertIn("nofile=4096:4096", command)
            self.assertIn("fsize=1073741824:1073741824", command)
            self.assertIn("host.docker.internal:host-gateway", command)
            self.assertIn("HTTP_PROXY=http://172.17.0.1:7890", command)
            self.assertIn("HTTPS_PROXY=http://172.17.0.1:7890", command)
            self.assertIn("http_proxy=http://172.17.0.1:7890", command)
            self.assertIn("https_proxy=http://172.17.0.1:7890", command)
            self.assertIn("PYTHONUSERBASE=/workspace/.python", command)
            self.assertIn("PIP_USER=1", command)
            self.assertIn("XDG_CACHE_HOME=/workspace/.agent/cache", command)

    def test_runner_mounts_trusted_ca_and_bypass_without_disabling_tls(self):
        with tempfile.TemporaryDirectory() as root:
            ca = Path(root) / "ca.pem"
            ca.write_text("test certificate")
            with patch("sandbox.broker.ssl.create_default_context") as trust:
                broker = SandboxBroker(
                    token=self.token, workspace_root=Path(root),
                    docker_workspace_root=Path(root), global_skills_root=Path(root),
                    docker_global_skills_root=Path(root), image="runner",
                    docker_binary="docker", max_concurrency=1,
                    workspace_uid=1000, workspace_gid=1000, network="bridge",
                    proxy_url="http://proxy:8080", ca_bundle=ca,
                    docker_ca_bundle=Path("/host/ca.pem"), no_proxy="localhost,internal",
                )
            trust.assert_called_once_with(cafile=str(ca))
            request = validate_request(self.payload, self.token)
            command, _ = broker.docker_command(request, broker.workspace_path(12))
            self.assertIn("type=bind,src=/host/ca.pem,dst=/etc/coregenie/ca-bundle.pem,readonly", command)
            for key in ["REQUESTS_CA_BUNDLE", "SSL_CERT_FILE", "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS", "GIT_SSL_CAINFO", "PIP_CERT"]:
                self.assertIn(key + "=/etc/coregenie/ca-bundle.pem", command)
            self.assertIn("NO_PROXY=localhost,internal", command)
            self.assertNotIn("NODE_TLS_REJECT_UNAUTHORIZED=0", command)

    def test_invalid_ca_fails_before_any_runner_is_created(self):
        with tempfile.TemporaryDirectory() as root:
            ca = Path(root) / "ca.pem"
            ca.write_text("not a certificate")
            common = dict(token=self.token, workspace_root=Path(root),
                          docker_workspace_root=Path(root), global_skills_root=Path(root),
                          docker_global_skills_root=Path(root), image="runner",
                          docker_binary="docker", max_concurrency=1, workspace_uid=1000,
                          workspace_gid=1000, network="bridge", proxy_url=None)
            for extra in [
                dict(ca_bundle=ca),
                dict(ca_bundle=ca, docker_ca_bundle=Path("relative.pem")),
                dict(ca_bundle=ca, docker_ca_bundle=Path("/host/ca.pem")),
                dict(no_proxy="localhost\ninvalid"),
            ]:
                with self.subTest(extra=extra), self.assertRaises(BrokerError):
                    SandboxBroker(**common, **extra)

    def test_reader_start_failure_reaps_docker_and_restores_capacity(self):
        with tempfile.TemporaryDirectory() as root:
            broker = SandboxBroker(
                token=self.token,
                workspace_root=Path(root),
                docker_workspace_root=Path(root),
                global_skills_root=Path(root),
                docker_global_skills_root=Path(root),
                image="anythingllm-sandbox:local",
                docker_binary="docker",
                max_concurrency=1,
                queue_timeout=0,
                workspace_uid=1000,
                workspace_gid=1000,
                network="bridge",
                proxy_url=None,
            )
            for failed_reader in (0, 1):
                with self.subTest(failed_reader=failed_reader):
                    process = MagicMock()
                    process.poll.return_value = None
                    readers = [MagicMock(), MagicMock()]
                    readers[failed_reader].start.side_effect = RuntimeError(
                        "can't start new thread"
                    )
                    with patch("sandbox.broker.subprocess.Popen", return_value=process), \
                         patch("sandbox.broker.threading.Thread", side_effect=readers), \
                         patch("sandbox.broker.os.killpg") as kill, \
                         patch.object(broker, "kill_container") as remove:
                        with self.assertRaisesRegex(RuntimeError, "new thread"):
                            broker.execute(self.payload)
                    kill.assert_called_once()
                    process.wait.assert_called_once_with(timeout=5)
                    remove.assert_called_once()
                    process.stdin.write.assert_not_called()
                    for stream in (process.stdin, process.stdout, process.stderr):
                        stream.close.assert_called_once()
                    if failed_reader:
                        readers[0].join.assert_called_once_with(timeout=2)
                    readers[failed_reader].join.assert_not_called()
                    self.assertTrue(broker.capacity.acquire(blocking=False))
                    broker.capacity.release()

    def test_cleanup_removes_created_containers_and_tolerates_docker_timeout(self):
        with patch("sandbox.broker.subprocess.run") as run:
            broker = SandboxBroker.__new__(SandboxBroker)
            broker.docker_binary = "docker"
            run.side_effect = subprocess.TimeoutExpired("docker", 5)
            broker.kill_container("runner")
            self.assertEqual(run.call_args.args[0], ["docker", "rm", "--force", "runner"])

    def test_runner_uses_configured_memory_limit(self):
        with tempfile.TemporaryDirectory() as root:
            broker = SandboxBroker(
                token=self.token,
                workspace_root=Path(root),
                docker_workspace_root=Path(root),
                global_skills_root=Path(root) / "global-skills",
                docker_global_skills_root=Path(root) / "global-skills",
                image="anythingllm-sandbox:local",
                docker_binary="docker",
                max_concurrency=1,
                queue_timeout=0,
                workspace_uid=1000,
                workspace_gid=1000,
                network="bridge",
                proxy_url=None,
                runner_memory="1g",
            )
            request = validate_request(self.payload, self.token)
            command, _ = broker.docker_command(
                request, broker.workspace_path(request["workspace_id"])
            )
            self.assertEqual(command[command.index("--memory") + 1], "1g")
            self.assertEqual(command[command.index("--memory-swap") + 1], "1g")

    def test_validates_and_mounts_global_skill_read_only(self):
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            revision = "b" * 64
            skill_root = root_path / "global-skills" / "7" / "revisions" / revision
            skill_root.mkdir(parents=True)
            (skill_root / "SKILL.md").write_text("---\nname: demo\ndescription: demo\n---\n")
            broker = SandboxBroker(
                token=self.token,
                workspace_root=root_path / "workspaces",
                docker_workspace_root=root_path / "workspaces",
                global_skills_root=root_path / "global-skills",
                docker_global_skills_root=root_path / "global-skills",
                image="anythingllm-sandbox:local",
                docker_binary="docker",
                max_concurrency=1,
                queue_timeout=0,
                workspace_uid=1000,
                workspace_gid=1000,
                network="bridge",
                proxy_url=None,
            )
            request = validate_request(
                {
                    **self.payload,
                    "timeoutSeconds": 1800,
                    "skill": {
                        "id": 7,
                        "name": "demo",
                        "scope": "global",
                        "revision": revision,
                    },
                },
                self.token,
            )
            command, _ = broker.docker_command(
                request, broker.workspace_path(request["workspace_id"])
            )
            self.assertEqual(request["timeout_seconds"], 1800)
            self.assertIn("/skills/demo", command)
            self.assertTrue(
                any("dst=/skills/demo,readonly" in value for value in command)
            )


if __name__ == "__main__":
    unittest.main()

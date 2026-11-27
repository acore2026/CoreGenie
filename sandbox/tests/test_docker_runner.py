"""Unit tests for Docker command construction, OutputBudget, and process cleanup."""

from __future__ import annotations

import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from sandbox_broker import OutputBudget, validate_request
from sandbox_broker.docker_runner import kill_container
from tests.helpers import TEST_TOKEN, make_broker, make_payload


class DockerRunnerTests(unittest.TestCase):
    def test_output_budget_truncates_cleanly(self) -> None:
        budget = OutputBudget(5)
        self.assertEqual(budget.take(b"abc"), b"abc")
        self.assertFalse(budget.truncated)
        self.assertEqual(budget.take(b"defg"), b"de")
        self.assertTrue(budget.truncated)
        self.assertEqual(budget.take(b"h"), b"")

    def test_runner_uses_configured_network_and_proxy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            broker = make_broker(
                Path(tmp),
                proxy_url="http://172.17.0.1:7890",
            )
            request = validate_request(make_payload(), TEST_TOKEN)
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

    def test_runner_uses_configured_memory_limit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            broker = make_broker(Path(tmp), runner_memory="1g")
            request = validate_request(make_payload(), TEST_TOKEN)
            command, _ = broker.docker_command(
                request, broker.workspace_path(request["workspace_id"])
            )
            self.assertEqual(command[command.index("--memory") + 1], "1g")
            self.assertEqual(command[command.index("--memory-swap") + 1], "1g")

    def test_timeout_covers_blocked_script_input_and_releases_capacity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            broker = make_broker(
                root,
                global_skills_root=root,
                docker_global_skills_root=root,
                image="test",
                network="none",
                queue_timeout=120,
            )
            payload = make_payload(
                language="bash",
                timeout_seconds=1,
                code="sleep 30\n#" + "x" * (128 * 1024),
            )
            started = time.monotonic()
            with (
                patch.object(
                    broker,
                    "docker_command",
                    return_value=(["bash", "--noprofile", "--norc", "-s"], "test-runner"),
                ),
                patch("sandbox_broker.docker_runner.kill_container") as remove,
            ):
                result = broker.execute(payload)
            self.assertTrue(result["timedOut"])
            self.assertLess(time.monotonic() - started, 5)
            remove.assert_called_once_with("docker", "test-runner")
            self.assertTrue(broker.capacity.acquire(blocking=False))
            broker.capacity.release()

    def test_reader_start_failure_reaps_docker_and_restores_capacity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            broker = make_broker(
                root,
                global_skills_root=root,
                docker_global_skills_root=root,
            )
            for failed_reader in (0, 1):
                with self.subTest(failed_reader=failed_reader):
                    process = MagicMock()
                    process.poll.return_value = None
                    readers = [MagicMock(), MagicMock()]
                    readers[failed_reader].start.side_effect = RuntimeError(
                        "can't start new thread"
                    )
                    with (
                        patch(
                            "sandbox_broker.docker_runner.subprocess.Popen",
                            return_value=process,
                        ),
                        patch(
                            "sandbox_broker.docker_runner.threading.Thread",
                            side_effect=readers,
                        ),
                        patch("sandbox_broker.docker_runner.os.killpg") as kill,
                        patch("sandbox_broker.docker_runner.kill_container") as remove,
                    ):
                        with self.assertRaisesRegex(RuntimeError, "new thread"):
                            broker.execute(make_payload())
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

    def test_cleanup_removes_created_containers_and_tolerates_docker_timeout(self) -> None:
        with patch("sandbox_broker.docker_runner.subprocess.run") as run:
            run.side_effect = subprocess.TimeoutExpired("docker", 5)
            kill_container("docker", "runner")
            self.assertEqual(
                run.call_args.args[0],
                ["docker", "rm", "--force", "runner"],
            )

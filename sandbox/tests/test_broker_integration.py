"""Unit and socket integration tests for SandboxBroker concurrency and IPC."""

from __future__ import annotations

import json
import os
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from sandbox_broker import BrokerError
from sandbox_broker.server import publish_unix_socket
from tests.helpers import make_broker, make_payload


class BrokerIntegrationTests(unittest.TestCase):
    def test_reports_capacity_pressure_as_retryable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            broker = make_broker(Path(tmp), queue_timeout=0)
            self.assertTrue(broker.capacity.acquire(blocking=False))
            try:
                with self.assertRaises(BrokerError) as raised:
                    broker.execute(make_payload())
                self.assertEqual(raised.exception.code, "SANDBOX_BUSY")
                self.assertTrue(raised.exception.retryable)
            finally:
                broker.capacity.release()

    def test_waits_for_capacity_instead_of_failing_a_short_burst(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            broker = make_broker(Path(tmp), queue_timeout=1)
            broker.capacity.acquire()
            entered = threading.Event()
            errors: list[str] = []

            def run() -> None:
                try:
                    broker.execute(make_payload())
                except BrokerError as exc:
                    errors.append(str(exc))

            def workspace(_workspace_id: int) -> Path:
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

    def test_unix_socket_round_trip_handles_errors_and_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            broker = make_broker(root)
            socket_path = root / "broker.sock"
            server, _inode = publish_unix_socket(
                socket_path,
                broker,
                socket_uid=os.getuid(),
                socket_gid=os.getgid(),
            )
            thread = threading.Thread(
                target=server.serve_forever,
                kwargs={"poll_interval": 0.05},
                daemon=True,
            )
            thread.start()
            try:
                bad_json = self._send_raw(socket_path, b"not-json\n")
                self.assertEqual(bad_json["ok"], False)
                self.assertIn("valid JSON", str(bad_json["error"]))

                unauth = self._send_raw(
                    socket_path,
                    (json.dumps(make_payload(token="wrong")) + "\n").encode("utf-8"),
                )
                self.assertEqual(unauth["ok"], False)
                self.assertEqual(unauth["error"], "unauthorized")
                self.assertEqual(unauth["code"], "SANDBOX_BROKER_ERROR")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    @staticmethod
    def _send_raw(socket_path: Path, message: bytes) -> dict[str, object]:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(socket_path))
            client.sendall(message)
            with client.makefile("rb") as reader:
                data = reader.readline()
        loaded: dict[str, object] = json.loads(data.decode("utf-8"))
        return loaded

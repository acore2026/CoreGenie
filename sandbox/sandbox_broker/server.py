"""Unix domain socket server, token provisioning, and atomic socket publication."""

from __future__ import annotations

import json
import os
import secrets
import socketserver
from pathlib import Path
from typing import cast

from .broker import SandboxBroker
from .config import MAX_REQUEST_BYTES
from .protocol import BrokerError, BrokerResponse


class RequestHandler(socketserver.StreamRequestHandler):
    """Line-delimited JSON handler over the broker Unix socket."""

    def handle(self) -> None:
        raw = self.rfile.readline(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            self.respond({"ok": False, "error": "request is too large"})
            return

        broker_server = cast(ThreadingUnixServer, self.server)
        result: BrokerResponse
        try:
            payload: object = json.loads(raw.decode("utf-8"))
            result = broker_server.broker.execute(payload)
        except (json.JSONDecodeError, UnicodeDecodeError):
            result = {"ok": False, "error": "request must contain valid JSON"}
        except BrokerError as exc:
            result = exc.to_response()
        except Exception as exc:  # Do not expose tracebacks over the socket.
            print(f"Unexpected broker error: {exc}", flush=True)
            result = {"ok": False, "error": "sandbox broker failed"}
        self.respond(result)

    def respond(self, payload: BrokerResponse) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8") + b"\n"
        try:
            self.wfile.write(encoded)
        except BrokenPipeError:
            pass


class ThreadingUnixServer(
    socketserver.ThreadingMixIn,
    socketserver.UnixStreamServer,
):
    """Multi-threaded Unix stream server backed by ``SandboxBroker``."""

    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128

    def __init__(
        self,
        socket_path: str,
        handler: type[socketserver.BaseRequestHandler],
        broker: SandboxBroker,
    ) -> None:
        self.broker = broker
        super().__init__(socket_path, handler)


def ensure_token(token_file: Path, socket_uid: int, socket_gid: int) -> str:
    """Load or generate the shared broker authentication token with 0640 perms."""
    token_file.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    if not token_file.exists():
        token_file.write_text(secrets.token_hex(32) + "\n", encoding="utf-8")
    os.chmod(token_file, 0o640)
    try:
        if os.geteuid() == 0:
            os.chown(token_file, socket_uid, socket_gid)
    except PermissionError:
        pass
    token = token_file.read_text(encoding="utf-8").strip()
    if len(token) < 32:
        raise SystemExit("Sandbox token is missing or too short")
    return token


def publish_unix_socket(
    socket_path: Path,
    broker: SandboxBroker,
    *,
    socket_uid: int,
    socket_gid: int,
) -> tuple[ThreadingUnixServer, int]:
    """Bind a staging socket, set permissions, and atomically publish it."""
    socket_path.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    staging_socket = socket_path.with_name(
        f"{socket_path.name}.{secrets.token_hex(4)}"
    )
    server = ThreadingUnixServer(str(staging_socket), RequestHandler, broker)
    os.chmod(staging_socket, 0o660)
    try:
        if os.geteuid() == 0:
            os.chown(staging_socket, socket_uid, socket_gid)
    except PermissionError:
        pass
    socket_inode = staging_socket.stat().st_ino
    staging_socket.replace(socket_path)
    return server, socket_inode


def serve_forever(
    server: ThreadingUnixServer,
    socket_path: Path,
    socket_inode: int,
) -> None:
    """Serve requests until interrupted and remove the socket only if still owned."""
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        if socket_path.is_socket() and socket_path.stat().st_ino == socket_inode:
            socket_path.unlink()

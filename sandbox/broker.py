#!/usr/bin/env python3
"""Narrow Docker execution broker for AnythingLLM's bash and python tools."""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import secrets
import signal
import socketserver
import subprocess
import threading
import uuid
from pathlib import Path
from typing import BinaryIO


MAX_REQUEST_BYTES = 96 * 1024
MAX_CODE_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 300
MAX_TIMEOUT_SECONDS = 1800
SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class BrokerError(Exception):
    """A safe error that may be returned to the AnythingLLM server."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "SANDBOX_BROKER_ERROR",
        retryable: bool = False,
    ):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def parse_positive_int(value: object, field: str) -> int:
    if isinstance(value, bool):
        raise BrokerError(f"{field} must be a positive integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise BrokerError(f"{field} must be a positive integer") from exc
    if parsed < 1 or str(parsed) != str(value):
        raise BrokerError(f"{field} must be a positive integer")
    return parsed


def validate_request(payload: object, expected_token: str) -> dict:
    if not isinstance(payload, dict):
        raise BrokerError("request must be a JSON object")

    supplied_token = payload.get("token")
    if not isinstance(supplied_token, str) or not hmac.compare_digest(
        supplied_token, expected_token
    ):
        raise BrokerError("unauthorized")

    language = payload.get("language")
    if language not in {"bash", "python"}:
        raise BrokerError("language must be bash or python")

    code = payload.get("code")
    if not isinstance(code, str) or not code.strip():
        raise BrokerError("code must be a non-empty string")
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        raise BrokerError(f"code exceeds the {MAX_CODE_BYTES}-byte limit")

    workspace_id = parse_positive_int(payload.get("workspaceId"), "workspaceId")

    try:
        invocation_id = str(uuid.UUID(str(payload.get("invocationId"))))
    except (TypeError, ValueError, AttributeError) as exc:
        raise BrokerError("invocationId must be a UUID") from exc

    timeout_seconds = payload.get("timeoutSeconds", DEFAULT_TIMEOUT_SECONDS)
    timeout_seconds = parse_positive_int(timeout_seconds, "timeoutSeconds")
    timeout_seconds = min(timeout_seconds, MAX_TIMEOUT_SECONDS)

    skill = payload.get("skill")
    if skill is not None:
        if not isinstance(skill, dict):
            raise BrokerError("skill must be an object")
        name = skill.get("name")
        scope = skill.get("scope")
        revision = skill.get("revision")
        if not isinstance(name, str) or not SKILL_NAME_PATTERN.fullmatch(name):
            raise BrokerError("invalid skill name")
        if scope not in {"global", "workspace"}:
            raise BrokerError("skill scope must be global or workspace")
        if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{64}", revision):
            raise BrokerError("invalid skill revision")
        skill_id = None
        if scope == "global":
            skill_id = parse_positive_int(skill.get("id"), "skill.id")
        skill = {
            "id": skill_id,
            "name": name,
            "scope": scope,
            "revision": revision,
        }

    return {
        "language": language,
        "code": code,
        "workspace_id": workspace_id,
        "invocation_id": invocation_id,
        "timeout_seconds": timeout_seconds,
        "skill": skill,
    }


class OutputBudget:
    def __init__(self, limit: int):
        self.remaining = limit
        self.lock = threading.Lock()
        self.truncated = False

    def take(self, chunk: bytes) -> bytes:
        with self.lock:
            if self.remaining <= 0:
                self.truncated = True
                return b""
            accepted = chunk[: self.remaining]
            self.remaining -= len(accepted)
            if len(accepted) != len(chunk):
                self.truncated = True
            return accepted


def drain_stream(stream: BinaryIO, output: bytearray, budget: OutputBudget) -> None:
    try:
        while True:
            chunk = stream.read(8192)
            if not chunk:
                return
            output.extend(budget.take(chunk))
    finally:
        stream.close()


class SandboxBroker:
    def __init__(
        self,
        *,
        token: str,
        workspace_root: Path,
        docker_workspace_root: Path,
        global_skills_root: Path,
        docker_global_skills_root: Path,
        image: str,
        docker_binary: str,
        max_concurrency: int,
        workspace_uid: int,
        workspace_gid: int,
        network: str,
        proxy_url: str | None,
    ):
        self.token = token
        self.workspace_root = workspace_root.resolve()
        if not docker_workspace_root.is_absolute():
            raise BrokerError("Docker workspace root must be absolute")
        self.docker_workspace_root = docker_workspace_root
        self.global_skills_root = global_skills_root.resolve()
        if not docker_global_skills_root.is_absolute():
            raise BrokerError("Docker global skills root must be absolute")
        self.docker_global_skills_root = docker_global_skills_root
        self.image = image
        self.docker_binary = docker_binary
        self.capacity = threading.BoundedSemaphore(max_concurrency)
        self.workspace_uid = workspace_uid
        self.workspace_gid = workspace_gid
        if network not in {"bridge", "none"}:
            raise BrokerError("sandbox network must be bridge or none")
        if proxy_url and ("\n" in proxy_url or "\r" in proxy_url):
            raise BrokerError("sandbox proxy URL must not contain newlines")
        self.network = network
        self.proxy_url = proxy_url

    def workspace_path(self, workspace_id: int) -> Path:
        self.workspace_root.mkdir(parents=True, exist_ok=True, mode=0o770)
        candidate = self.workspace_root / f"workspace-{workspace_id}"
        if candidate.is_symlink():
            raise BrokerError("workspace root must not be a symbolic link")
        candidate.mkdir(parents=True, exist_ok=True, mode=0o770)
        try:
            if os.geteuid() == 0:
                os.chown(candidate, self.workspace_uid, self.workspace_gid)
            os.chmod(candidate, 0o770)
        except PermissionError as exc:
            raise BrokerError(
                "broker cannot set writable workspace ownership"
            ) from exc
        resolved = candidate.resolve()
        if resolved.parent != self.workspace_root:
            raise BrokerError("invalid workspace path")
        return resolved

    def skill_runtime(self, request: dict, workspace_path: Path) -> tuple[str, list[str]]:
        skill = request.get("skill")
        if not skill:
            return "/workspace", []
        name = skill["name"]
        if skill["scope"] == "workspace":
            skills_root = (workspace_path / ".agent" / "skills").resolve()
            candidate = skills_root / name
            if candidate.is_symlink() or not candidate.is_dir():
                raise BrokerError("workspace skill directory is unavailable")
            resolved = candidate.resolve()
            if resolved.parent != skills_root:
                raise BrokerError("invalid workspace skill path")
            return f"/workspace/.agent/skills/{name}", []

        relative = Path(str(skill["id"])) / "revisions" / skill["revision"]
        candidate = self.global_skills_root / relative
        if candidate.is_symlink() or not candidate.is_dir():
            raise BrokerError("global skill revision is unavailable")
        resolved = candidate.resolve()
        expected_parent = (
            self.global_skills_root / str(skill["id"]) / "revisions"
        ).resolve()
        if resolved.parent != expected_parent:
            raise BrokerError("invalid global skill path")
        docker_source = self.docker_global_skills_root / relative
        destination = f"/skills/{name}"
        return destination, [
            "--mount",
            f"type=bind,src={docker_source},dst={destination},readonly",
        ]

    def docker_command(self, request: dict, workspace_path: Path) -> tuple[list[str], str]:
        run_id = secrets.token_hex(6)
        invocation_label = request["invocation_id"].replace("-", "")[:12]
        container_name = f"anythingllm-sandbox-{invocation_label}-{run_id}"
        docker_workspace_path = (
            self.docker_workspace_root / workspace_path.name
        )
        workdir, skill_mount = self.skill_runtime(request, workspace_path)
        command = [
            self.docker_binary,
            "run",
            "--rm",
            "--interactive",
            "--name",
            container_name,
            "--label",
            "anythingllm.sandbox=true",
            "--label",
            f"anythingllm.workspace={request['workspace_id']}",
            "--network",
            self.network,
            "--add-host",
            "host.docker.internal:host-gateway",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "--pids-limit",
            "64",
            "--memory",
            "256m",
            "--memory-swap",
            "256m",
            "--cpus",
            "0.5",
            "--ulimit",
            "nofile=256:256",
            "--ulimit",
            "fsize=67108864:67108864",
            "--user",
            f"{self.workspace_uid}:{self.workspace_gid}",
            "--env",
            "HOME=/tmp",
            "--env",
            "PYTHONDONTWRITEBYTECODE=1",
            "--env",
            "PYTHONUNBUFFERED=1",
            "--env",
            "PYTHONUSERBASE=/workspace/.python",
            "--env",
            "PIP_USER=1",
            "--env",
            "PIP_CACHE_DIR=/workspace/.agent/cache/pip",
            "--env",
            "XDG_CACHE_HOME=/workspace/.agent/cache",
            "--env",
            "UV_CACHE_DIR=/workspace/.agent/cache/uv",
            "--env",
            "WORKSPACE=/workspace",
            "--env",
            f"SKILL_ROOT={workdir if request.get('skill') else ''}",
            "--env",
            "PATH=/workspace/.python/bin:/usr/local/bin:/usr/bin:/bin",
            "--tmpfs",
            f"/tmp:rw,noexec,nosuid,nodev,size=64m,uid={self.workspace_uid},gid={self.workspace_gid},mode=700",
            "--mount",
            f"type=bind,src={docker_workspace_path},dst=/workspace",
            *skill_mount,
            "--workdir",
            workdir,
        ]
        if self.proxy_url:
            for variable in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
                command.extend(["--env", f"{variable}={self.proxy_url}"])
            command.extend(
                [
                    "--env",
                    "NO_PROXY=localhost,127.0.0.1,::1",
                    "--env",
                    "no_proxy=localhost,127.0.0.1,::1",
                ]
            )
        command.append(self.image)
        if request["language"] == "bash":
            command.extend(["bash", "--noprofile", "--norc", "-s"])
        else:
            command.extend(["python3", "-B", "-"])
        return command, container_name

    def kill_container(self, container_name: str) -> None:
        subprocess.run(
            [self.docker_binary, "kill", container_name],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )

    def execute(self, payload: object) -> dict:
        request = validate_request(payload, self.token)
        if not self.capacity.acquire(blocking=False):
            raise BrokerError(
                "sandbox capacity is busy; retry shortly",
                code="SANDBOX_BUSY",
                retryable=True,
            )

        try:
            workspace_path = self.workspace_path(request["workspace_id"])
            command, container_name = self.docker_command(request, workspace_path)
            try:
                process = subprocess.Popen(
                    command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    start_new_session=True,
                )
            except OSError as exc:
                raise BrokerError(f"could not start Docker: {exc}") from exc

            stdout = bytearray()
            stderr = bytearray()
            budget = OutputBudget(MAX_OUTPUT_BYTES)
            readers = [
                threading.Thread(
                    target=drain_stream,
                    args=(process.stdout, stdout, budget),
                    daemon=True,
                ),
                threading.Thread(
                    target=drain_stream,
                    args=(process.stderr, stderr, budget),
                    daemon=True,
                ),
            ]
            for reader in readers:
                reader.start()

            try:
                process.stdin.write(request["code"].encode("utf-8"))
                process.stdin.close()
            except BrokenPipeError:
                pass

            timed_out = False
            try:
                exit_code = process.wait(timeout=request["timeout_seconds"])
            except subprocess.TimeoutExpired:
                timed_out = True
                self.kill_container(container_name)
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                exit_code = process.wait(timeout=5)

            for reader in readers:
                reader.join(timeout=2)

            return {
                "ok": True,
                "exitCode": exit_code,
                "stdout": stdout.decode("utf-8", errors="replace"),
                "stderr": stderr.decode("utf-8", errors="replace"),
                "timedOut": timed_out,
                "truncated": budget.truncated,
            }
        finally:
            self.capacity.release()


class RequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        raw = self.rfile.readline(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            self.respond({"ok": False, "error": "request is too large"})
            return
        try:
            payload = json.loads(raw.decode("utf-8"))
            result = self.server.broker.execute(payload)
        except (json.JSONDecodeError, UnicodeDecodeError):
            result = {"ok": False, "error": "request must contain valid JSON"}
        except BrokerError as exc:
            result = {
                "ok": False,
                "code": exc.code,
                "error": str(exc),
                "retryable": exc.retryable,
            }
        except Exception as exc:  # Do not expose a traceback over the socket.
            print(f"Unexpected broker error: {exc}", flush=True)
            result = {"ok": False, "error": "sandbox broker failed"}
        self.respond(result)

    def respond(self, payload: dict) -> None:
        self.wfile.write(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        self.wfile.write(b"\n")


class ThreadingUnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, path: str, handler, broker: SandboxBroker):
        self.broker = broker
        super().__init__(path, handler)


def ensure_token(token_file: Path, socket_uid: int, socket_gid: int) -> str:
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True, type=Path)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--workspace-root", required=True, type=Path)
    parser.add_argument("--docker-workspace-root", required=True, type=Path)
    parser.add_argument("--global-skills-root", required=True, type=Path)
    parser.add_argument("--docker-global-skills-root", required=True, type=Path)
    parser.add_argument("--image", default="anythingllm-sandbox:local")
    parser.add_argument("--docker-binary", default="docker")
    parser.add_argument("--max-concurrency", type=int, default=6)
    parser.add_argument("--socket-uid", type=int, default=os.getuid())
    parser.add_argument("--socket-gid", type=int, default=os.getgid())
    parser.add_argument("--workspace-uid", type=int, default=1000)
    parser.add_argument("--workspace-gid", type=int, default=1000)
    parser.add_argument("--network", choices=("bridge", "none"), default="bridge")
    parser.add_argument("--proxy-url")
    args = parser.parse_args()

    if args.max_concurrency < 1 or args.max_concurrency > 16:
        raise SystemExit("--max-concurrency must be between 1 and 16")

    args.socket.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    if args.socket.exists() or args.socket.is_socket():
        args.socket.unlink()

    token = ensure_token(args.token_file, args.socket_uid, args.socket_gid)
    broker = SandboxBroker(
        token=token,
        workspace_root=args.workspace_root,
        docker_workspace_root=args.docker_workspace_root,
        global_skills_root=args.global_skills_root,
        docker_global_skills_root=args.docker_global_skills_root,
        image=args.image,
        docker_binary=args.docker_binary,
        max_concurrency=args.max_concurrency,
        workspace_uid=args.workspace_uid,
        workspace_gid=args.workspace_gid,
        network=args.network,
        proxy_url=args.proxy_url,
    )
    server = ThreadingUnixServer(str(args.socket), RequestHandler, broker)
    os.chmod(args.socket, 0o660)
    try:
        if os.geteuid() == 0:
            os.chown(args.socket, args.socket_uid, args.socket_gid)
    except PermissionError:
        pass

    print(
        f"AnythingLLM sandbox broker listening on {args.socket} "
        f"with image {args.image} and network {args.network}",
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        if args.socket.exists() or args.socket.is_socket():
            args.socket.unlink()


if __name__ == "__main__":
    main()

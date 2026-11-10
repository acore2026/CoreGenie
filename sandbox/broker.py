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


MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_CODE_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 900
MAX_TIMEOUT_SECONDS = 7200
SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RUNNER_MEMORY_PATTERN = re.compile(r"^[1-9][0-9]*(?:[bkmg])?$")


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

    raw_invocation_id = payload.get("invocationId")
    if not isinstance(raw_invocation_id, str) or not re.fullmatch(
        r"[A-Za-z0-9_-]{1,128}", raw_invocation_id
    ):
        raise BrokerError("invocationId must be a bounded run or tool-call ID")
    try:
        invocation_id = str(uuid.UUID(raw_invocation_id))
    except ValueError:
        # Older clients pass provider tool-call IDs for child Agents. Map them
        # to safe container labels without requiring an application restart.
        invocation_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL, f"anythingllm:{workspace_id}:{raw_invocation_id}"
        ))

    timeout_seconds = payload.get("timeoutSeconds", DEFAULT_TIMEOUT_SECONDS)
    timeout_seconds = parse_positive_int(timeout_seconds, "timeoutSeconds")
    timeout_seconds = min(timeout_seconds, MAX_TIMEOUT_SECONDS)
    queue_timeout_seconds = min(
        parse_positive_int(payload.get("queueTimeoutSeconds", 10), "queueTimeoutSeconds"),
        120,
    )

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
        "queue_timeout_seconds": queue_timeout_seconds,
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
        runner_memory: str = "4g",
        queue_timeout: float = 120,
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
        self.queue_timeout = queue_timeout
        self.workspace_uid = workspace_uid
        self.workspace_gid = workspace_gid
        if not RUNNER_MEMORY_PATTERN.fullmatch(runner_memory.lower()):
            raise BrokerError("runner memory must be a positive Docker memory value")
        self.runner_memory = runner_memory.lower()
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
            "512",
            "--memory",
            self.runner_memory,
            "--memory-swap",
            self.runner_memory,
            "--cpus",
            "2",
            "--ulimit",
            "nofile=4096:4096",
            "--ulimit",
            "fsize=1073741824:1073741824",
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
            f"/tmp:rw,noexec,nosuid,nodev,size=512m,uid={self.workspace_uid},gid={self.workspace_gid},mode=700",
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
        try:
            subprocess.run(
                [self.docker_binary, "rm", "--force", container_name],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass

    def stop_process(self, process: subprocess.Popen, container_name: str) -> None:
        try:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=5)
        finally:
            self.kill_container(container_name)

    def execute(self, payload: object) -> dict:
        request = validate_request(payload, self.token)
        if not self.capacity.acquire(
            timeout=min(self.queue_timeout, request["queue_timeout_seconds"])
        ):
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
            readers = []
            completed = False
            try:
                pending_readers = [
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
                for reader in pending_readers:
                    reader.start()
                    readers.append(reader)

                input_errors = []

                def send_input():
                    try:
                        process.stdin.write(request["code"].encode("utf-8"))
                    except BrokenPipeError:
                        pass
                    except OSError as exc:
                        input_errors.append(exc)
                    finally:
                        process.stdin.close()

                # Bash can execute before consuming all input; include pipe writes
                # in the execution timeout even when a large script fills stdin.
                writer = threading.Thread(target=send_input, daemon=True)
                writer.start()
                readers.append(writer)

                timed_out = False
                try:
                    exit_code = process.wait(timeout=request["timeout_seconds"])
                except subprocess.TimeoutExpired:
                    timed_out = True
                    self.stop_process(process, container_name)
                    exit_code = process.returncode
                completed = True
            finally:
                # Reader startup can fail before stdin is sent, leaving Docker idle.
                try:
                    if not completed:
                        self.stop_process(process, container_name)
                finally:
                    for reader in readers:
                        reader.join(timeout=2)
                    for stream in (process.stdin, process.stdout, process.stderr):
                        stream.close()

            if input_errors and not timed_out:
                raise input_errors[0]

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
    request_queue_size = 128

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
    parser.add_argument("--max-concurrency", type=int, default=12)
    parser.add_argument("--runner-memory", default="4g")
    parser.add_argument("--socket-uid", type=int, default=os.getuid())
    parser.add_argument("--socket-gid", type=int, default=os.getgid())
    parser.add_argument("--workspace-uid", type=int, default=1000)
    parser.add_argument("--workspace-gid", type=int, default=1000)
    parser.add_argument("--network", choices=("bridge", "none"), default="bridge")
    parser.add_argument("--proxy-url")
    args = parser.parse_args()

    if args.max_concurrency < 1 or args.max_concurrency > 64:
        raise SystemExit("--max-concurrency must be between 1 and 64")

    args.socket.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
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
        runner_memory=args.runner_memory,
        workspace_uid=args.workspace_uid,
        workspace_gid=args.workspace_gid,
        network=args.network,
        proxy_url=args.proxy_url,
    )
    # Publish only after listen/permissions are ready. Existing connections to
    # an older broker keep working while the new broker accepts fresh calls.
    staging_socket = args.socket.with_name(
        f"{args.socket.name}.{secrets.token_hex(4)}"
    )
    server = ThreadingUnixServer(str(staging_socket), RequestHandler, broker)
    os.chmod(staging_socket, 0o660)
    try:
        if os.geteuid() == 0:
            os.chown(staging_socket, args.socket_uid, args.socket_gid)
    except PermissionError:
        pass
    socket_inode = staging_socket.stat().st_ino
    staging_socket.replace(args.socket)

    print(
        f"AnythingLLM sandbox broker listening on {args.socket} "
        f"with image {args.image} and network {args.network}",
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        if args.socket.is_socket() and args.socket.stat().st_ino == socket_inode:
            args.socket.unlink()


if __name__ == "__main__":
    main()

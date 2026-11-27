"""Docker runner command construction, bounded stream I/O, and process cleanup."""

from __future__ import annotations

import os
import secrets
import signal
import subprocess
import threading
from collections.abc import Sequence
from pathlib import Path
from typing import BinaryIO

from .config import (
    CONTAINER_CA_BUNDLE_PATH,
    MAX_OUTPUT_BYTES,
    RUNNER_CA_ENV_VARS,
    RUNNER_CPUS,
    RUNNER_FSIZE_ULIMIT,
    RUNNER_NOFILE_ULIMIT,
    RUNNER_PIDS_LIMIT,
    RUNNER_PROXY_ENV_VARS,
    RUNNER_TMPFS_SIZE,
    BrokerConfig,
)
from .mounts import SkillMount
from .protocol import BrokerError, ExecutionRequest, ExecutionSuccess


class OutputBudget:
    """Thread-safe shared byte cap across stdout and stderr."""

    def __init__(self, limit: int) -> None:
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
    """Drain a subprocess byte stream into ``output`` under ``budget``."""
    try:
        while True:
            chunk = stream.read(8192)
            if not chunk:
                return
            output.extend(budget.take(chunk))
    finally:
        stream.close()


def _base_container_args(
    config: BrokerConfig,
    request: ExecutionRequest,
    container_name: str,
    docker_workspace_path: Path,
    skill_mount: SkillMount,
) -> list[str]:
    skill_root = skill_mount.workdir if request["skill"] is not None else ""
    tmpfs_spec = (
        f"/tmp:rw,noexec,nosuid,nodev,size={RUNNER_TMPFS_SIZE},"
        f"uid={config.workspace_uid},gid={config.workspace_gid},mode=700"
    )
    return [
        config.docker_binary,
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
        config.network,
        "--add-host",
        "host.docker.internal:host-gateway",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--pids-limit",
        RUNNER_PIDS_LIMIT,
        "--memory",
        config.runner_memory,
        "--memory-swap",
        config.runner_memory,
        "--cpus",
        RUNNER_CPUS,
        "--ulimit",
        RUNNER_NOFILE_ULIMIT,
        "--ulimit",
        RUNNER_FSIZE_ULIMIT,
        "--user",
        f"{config.workspace_uid}:{config.workspace_gid}",
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
        f"SKILL_ROOT={skill_root}",
        "--env",
        "PATH=/workspace/.python/bin:/usr/local/bin:/usr/bin:/bin",
        "--tmpfs",
        tmpfs_spec,
        "--mount",
        f"type=bind,src={docker_workspace_path},dst=/workspace",
        *skill_mount.docker_args,
        "--workdir",
        skill_mount.workdir,
    ]


def _proxy_env_args(config: BrokerConfig) -> list[str]:
    if not config.proxy_url:
        return []
    args: list[str] = []
    for variable in RUNNER_PROXY_ENV_VARS:
        args.extend(["--env", f"{variable}={config.proxy_url}"])
    args.extend(
        [
            "--env",
            "NODE_USE_ENV_PROXY=1",
            "--env",
            f"NO_PROXY={config.no_proxy}",
            "--env",
            f"no_proxy={config.no_proxy}",
        ]
    )
    return args


def _ca_bundle_args(config: BrokerConfig) -> list[str]:
    if config.docker_ca_bundle is None:
        return []
    args = [
        "--mount",
        f"type=bind,src={config.docker_ca_bundle},dst={CONTAINER_CA_BUNDLE_PATH},readonly",
    ]
    for variable in RUNNER_CA_ENV_VARS:
        args.extend(["--env", f"{variable}={CONTAINER_CA_BUNDLE_PATH}"])
    return args


def _language_entrypoint(request: ExecutionRequest) -> list[str]:
    if request["language"] == "bash":
        return ["bash", "--noprofile", "--norc", "-s"]
    return ["python3", "-B", "-"]


def build_docker_command(
    config: BrokerConfig,
    request: ExecutionRequest,
    workspace_path: Path,
    skill_mount: SkillMount,
) -> tuple[list[str], str]:
    """Build the full ``docker run`` invocation and unique container name."""
    run_id = secrets.token_hex(6)
    invocation_label = request["invocation_id"].replace("-", "")[:12]
    container_name = f"anythingllm-sandbox-{invocation_label}-{run_id}"
    docker_workspace_path = config.docker_workspace_root / workspace_path.name

    command = [
        *_base_container_args(
            config, request, container_name, docker_workspace_path, skill_mount
        ),
        *_proxy_env_args(config),
        *_ca_bundle_args(config),
        config.image,
        *_language_entrypoint(request),
    ]
    return command, container_name


def kill_container(docker_binary: str, container_name: str) -> None:
    """Force-remove a runner container, tolerating CLI errors or timeouts."""
    try:
        subprocess.run(
            [docker_binary, "rm", "--force", container_name],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def stop_process(
    process: subprocess.Popen[bytes],
    docker_binary: str,
    container_name: str,
) -> None:
    """Terminate the docker CLI process group and force-remove the container."""
    try:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=5)
    finally:
        kill_container(docker_binary, container_name)


def run_container(
    command: Sequence[str],
    *,
    code: str,
    timeout_seconds: int,
    docker_binary: str,
    container_name: str,
) -> ExecutionSuccess:
    """Execute a prepared Docker command with bounded I/O and hard timeout."""
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

    stdin_stream = process.stdin
    stdout_stream = process.stdout
    stderr_stream = process.stderr
    if stdin_stream is None or stdout_stream is None or stderr_stream is None:
        stop_process(process, docker_binary, container_name)
        raise BrokerError("could not attach stdio pipes to Docker process")

    stdout = bytearray()
    stderr = bytearray()
    budget = OutputBudget(MAX_OUTPUT_BYTES)
    workers: list[threading.Thread] = []
    input_errors: list[OSError] = []
    completed = False

    def send_input() -> None:
        try:
            stdin_stream.write(code.encode("utf-8"))
        except BrokenPipeError:
            pass
        except OSError as exc:
            input_errors.append(exc)
        finally:
            stdin_stream.close()

    try:
        for stream, buffer in ((stdout_stream, stdout), (stderr_stream, stderr)):
            reader = threading.Thread(
                target=drain_stream,
                args=(stream, buffer, budget),
                daemon=True,
            )
            reader.start()
            workers.append(reader)

        # Bash can execute before consuming all input; include pipe writes
        # in the execution timeout even when a large script fills stdin.
        writer = threading.Thread(target=send_input, daemon=True)
        writer.start()
        workers.append(writer)

        timed_out = False
        try:
            exit_code: int | None = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            stop_process(process, docker_binary, container_name)
            exit_code = process.returncode
        completed = True
    finally:
        # Reader startup can fail before stdin is sent, leaving Docker idle.
        try:
            if not completed:
                stop_process(process, docker_binary, container_name)
        finally:
            for worker in workers:
                worker.join(timeout=2)
            for stream in (stdin_stream, stdout_stream, stderr_stream):
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

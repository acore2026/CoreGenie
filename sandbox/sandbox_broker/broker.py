"""SandboxBroker orchestrator combining capacity limits, mounts, and Docker execution."""

from __future__ import annotations

import threading
from pathlib import Path

from .config import (
    DEFAULT_NO_PROXY,
    DEFAULT_RUNNER_MEMORY,
    MAX_QUEUE_TIMEOUT_SECONDS,
    BrokerConfig,
    NetworkMode,
)
from .docker_runner import build_docker_command, kill_container, run_container
from .mounts import SkillMount, ensure_workspace_dir, resolve_skill_mount
from .protocol import (
    BrokerError,
    ExecutionRequest,
    ExecutionSuccess,
    validate_request,
)


class SandboxBroker:
    """Executes validated bash/python requests in disposable Docker containers."""

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
        network: NetworkMode,
        proxy_url: str | None,
        runner_memory: str = DEFAULT_RUNNER_MEMORY,
        queue_timeout: float = float(MAX_QUEUE_TIMEOUT_SECONDS),
        ca_bundle: Path | None = None,
        docker_ca_bundle: Path | None = None,
        no_proxy: str = DEFAULT_NO_PROXY,
    ) -> None:
        config = BrokerConfig(
            token=token,
            workspace_root=workspace_root,
            docker_workspace_root=docker_workspace_root,
            global_skills_root=global_skills_root,
            docker_global_skills_root=docker_global_skills_root,
            image=image,
            docker_binary=docker_binary,
            max_concurrency=max_concurrency,
            workspace_uid=workspace_uid,
            workspace_gid=workspace_gid,
            network=network,
            proxy_url=proxy_url,
            runner_memory=runner_memory,
            queue_timeout=queue_timeout,
            ca_bundle=ca_bundle,
            docker_ca_bundle=docker_ca_bundle,
            no_proxy=no_proxy,
        )
        self._init_from_config(config)

    @classmethod
    def from_config(cls, config: BrokerConfig) -> SandboxBroker:
        instance = cls.__new__(cls)
        instance._init_from_config(config)
        return instance

    def _init_from_config(self, config: BrokerConfig) -> None:
        self.config = config
        self.token = config.token
        self.docker_binary = config.docker_binary
        self.queue_timeout = config.queue_timeout
        self.capacity = threading.BoundedSemaphore(config.max_concurrency)

    def workspace_path(self, workspace_id: int) -> Path:
        return ensure_workspace_dir(self.config, workspace_id)

    def skill_runtime(
        self,
        request: ExecutionRequest,
        workspace_path: Path,
    ) -> tuple[str, list[str]]:
        mount = resolve_skill_mount(self.config, request["skill"], workspace_path)
        return mount.workdir, list(mount.docker_args)

    def docker_command(
        self,
        request: ExecutionRequest,
        workspace_path: Path,
    ) -> tuple[list[str], str]:
        workdir, mount_args = self.skill_runtime(request, workspace_path)
        mount = SkillMount(workdir=workdir, docker_args=tuple(mount_args))
        return build_docker_command(self.config, request, workspace_path, mount)

    def kill_container(self, container_name: str) -> None:
        kill_container(self.docker_binary, container_name)

    def execute(self, payload: object) -> ExecutionSuccess:
        request = validate_request(payload, self.token)
        wait_timeout = min(self.queue_timeout, float(request["queue_timeout_seconds"]))
        if not self.capacity.acquire(timeout=wait_timeout):
            raise BrokerError(
                "sandbox capacity is busy; retry shortly",
                code="SANDBOX_BUSY",
                retryable=True,
            )

        try:
            workspace_path = self.workspace_path(request["workspace_id"])
            command, container_name = self.docker_command(request, workspace_path)
            return run_container(
                command,
                code=request["code"],
                timeout_seconds=request["timeout_seconds"],
                docker_binary=self.docker_binary,
                container_name=container_name,
            )
        finally:
            self.capacity.release()

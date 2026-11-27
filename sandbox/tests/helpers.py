"""Shared typed factories for sandbox broker unit tests."""

from __future__ import annotations

import uuid
from pathlib import Path

from sandbox_broker import NetworkMode, SandboxBroker

TEST_TOKEN = "a" * 64
_UNSET = object()


def make_payload(
    *,
    token: str = TEST_TOKEN,
    language: str = "python",
    code: str = "print('ok')",
    workspace_id: object = 12,
    invocation_id: object = _UNSET,
    timeout_seconds: object = 5,
    extra: dict[str, object] | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "token": token,
        "language": language,
        "code": code,
        "workspaceId": workspace_id,
        "invocationId": str(uuid.uuid4()) if invocation_id is _UNSET else invocation_id,
        "timeoutSeconds": timeout_seconds,
    }
    if extra:
        payload.update(extra)
    return payload


def make_broker(
    root: Path,
    *,
    token: str = TEST_TOKEN,
    workspace_root: Path | None = None,
    docker_workspace_root: Path | None = None,
    global_skills_root: Path | None = None,
    docker_global_skills_root: Path | None = None,
    image: str = "anythingllm-sandbox:local",
    docker_binary: str = "docker",
    max_concurrency: int = 1,
    queue_timeout: float = 0,
    workspace_uid: int = 1000,
    workspace_gid: int = 1000,
    network: NetworkMode = "bridge",
    proxy_url: str | None = None,
    runner_memory: str = "4g",
    ca_bundle: Path | None = None,
    docker_ca_bundle: Path | None = None,
    no_proxy: str = "localhost,127.0.0.1,::1",
) -> SandboxBroker:
    return SandboxBroker(
        token=token,
        workspace_root=workspace_root or root,
        docker_workspace_root=docker_workspace_root or root,
        global_skills_root=global_skills_root or (root / "global-skills"),
        docker_global_skills_root=docker_global_skills_root or (root / "global-skills"),
        image=image,
        docker_binary=docker_binary,
        max_concurrency=max_concurrency,
        queue_timeout=queue_timeout,
        workspace_uid=workspace_uid,
        workspace_gid=workspace_gid,
        network=network,
        proxy_url=proxy_url,
        runner_memory=runner_memory,
        ca_bundle=ca_bundle,
        docker_ca_bundle=docker_ca_bundle,
        no_proxy=no_proxy,
    )

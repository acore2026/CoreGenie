"""Configuration constants and validated settings for the sandbox broker."""

from __future__ import annotations

import re
import ssl
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_CODE_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024

DEFAULT_TIMEOUT_SECONDS = 900
MAX_TIMEOUT_SECONDS = 7200
DEFAULT_QUEUE_TIMEOUT_SECONDS = 10
MAX_QUEUE_TIMEOUT_SECONDS = 120

MIN_CONCURRENCY = 1
MAX_CONCURRENCY = 64
DEFAULT_MAX_CONCURRENCY = 12

DEFAULT_IMAGE = "anythingllm-sandbox:local"
DEFAULT_DOCKER_BINARY = "docker"
DEFAULT_RUNNER_MEMORY = "4g"
DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1"
DEFAULT_WORKSPACE_UID = 1000
DEFAULT_WORKSPACE_GID = 1000

RUNNER_PIDS_LIMIT = "512"
RUNNER_CPUS = "2"
RUNNER_NOFILE_ULIMIT = "nofile=4096:4096"
RUNNER_FSIZE_ULIMIT = "fsize=1073741824:1073741824"
RUNNER_TMPFS_SIZE = "512m"
CONTAINER_CA_BUNDLE_PATH = "/etc/coregenie/ca-bundle.pem"

RUNNER_PROXY_ENV_VARS: tuple[str, ...] = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
)
RUNNER_CA_ENV_VARS: tuple[str, ...] = (
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "GIT_SSL_CAINFO",
    "PIP_CERT",
)

SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKILL_REVISION_PATTERN = re.compile(r"^[a-f0-9]{64}$")
INVOCATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
RUNNER_MEMORY_PATTERN = re.compile(r"^[1-9][0-9]*(?:[bkmg])?$")

NetworkMode = Literal["bridge", "none"]


def validate_ca_bundle(
    ca_bundle: Path | None,
    docker_ca_bundle: Path | None,
) -> None:
    """Validate optional enterprise CA bundle paths and PEM readability."""
    from .protocol import BrokerError

    if bool(ca_bundle) != bool(docker_ca_bundle):
        raise BrokerError("both CA bundle paths are required")
    if ca_bundle is None or docker_ca_bundle is None:
        return
    if not ca_bundle.is_absolute() or not ca_bundle.is_file():
        raise BrokerError("CA bundle must be an existing absolute file")
    if not docker_ca_bundle.is_absolute() or any(
        ch in str(docker_ca_bundle) for ch in ",\r\n"
    ):
        raise BrokerError("Docker CA bundle must be an absolute mount-safe path")
    try:
        ssl.create_default_context(cafile=str(ca_bundle))
    except (OSError, ssl.SSLError) as exc:
        raise BrokerError("CA bundle cannot be loaded") from exc


@dataclass(frozen=True, slots=True)
class BrokerConfig:
    """Immutable, pre-validated configuration for ``SandboxBroker``."""

    token: str
    workspace_root: Path
    docker_workspace_root: Path
    global_skills_root: Path
    docker_global_skills_root: Path
    image: str
    docker_binary: str
    max_concurrency: int
    workspace_uid: int
    workspace_gid: int
    network: NetworkMode
    proxy_url: str | None
    runner_memory: str = DEFAULT_RUNNER_MEMORY
    queue_timeout: float = float(MAX_QUEUE_TIMEOUT_SECONDS)
    ca_bundle: Path | None = None
    docker_ca_bundle: Path | None = None
    no_proxy: str = DEFAULT_NO_PROXY

    def __post_init__(self) -> None:
        from .protocol import BrokerError

        object.__setattr__(self, "workspace_root", self.workspace_root.resolve())
        if not self.docker_workspace_root.is_absolute():
            raise BrokerError("Docker workspace root must be absolute")

        object.__setattr__(
            self, "global_skills_root", self.global_skills_root.resolve()
        )
        if not self.docker_global_skills_root.is_absolute():
            raise BrokerError("Docker global skills root must be absolute")

        if self.max_concurrency < MIN_CONCURRENCY or self.max_concurrency > MAX_CONCURRENCY:
            raise BrokerError(
                f"max concurrency must be between {MIN_CONCURRENCY} and {MAX_CONCURRENCY}"
            )

        normalized_memory = self.runner_memory.lower()
        if not RUNNER_MEMORY_PATTERN.fullmatch(normalized_memory):
            raise BrokerError("runner memory must be a positive Docker memory value")
        object.__setattr__(self, "runner_memory", normalized_memory)

        if self.network not in ("bridge", "none"):
            raise BrokerError("sandbox network must be bridge or none")
        if self.proxy_url and ("\n" in self.proxy_url or "\r" in self.proxy_url):
            raise BrokerError("sandbox proxy URL must not contain newlines")
        if any(ch in self.no_proxy for ch in "\r\n"):
            raise BrokerError("sandbox bypass list must not contain newlines")

        validate_ca_bundle(self.ca_bundle, self.docker_ca_bundle)

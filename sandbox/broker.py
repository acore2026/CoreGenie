#!/usr/bin/env python3
"""CLI entrypoint and compatibility exports for the CoreGenie sandbox broker."""

from __future__ import annotations

import sys
from pathlib import Path

# Support running directly (`python3 /opt/anythingllm-sandbox/broker.py`) and
# importing via `sandbox.broker` from the repository root.
_SANDBOX_DIR = str(Path(__file__).resolve().parent)
if _SANDBOX_DIR not in sys.path:
    sys.path.insert(0, _SANDBOX_DIR)

from sandbox_broker import (  # noqa: E402
    BrokerConfig,
    BrokerError,
    BrokerResponse,
    ErrorResponse,
    ExecutionRequest,
    ExecutionSuccess,
    Language,
    NetworkMode,
    OutputBudget,
    RequestHandler,
    SandboxBroker,
    SkillMount,
    SkillRequest,
    SkillScope,
    ThreadingUnixServer,
    build_docker_command,
    drain_stream,
    ensure_token,
    ensure_workspace_dir,
    main,
    parse_positive_int,
    resolve_skill_mount,
    validate_request,
)

__all__ = [
    "BrokerConfig",
    "BrokerError",
    "BrokerResponse",
    "ErrorResponse",
    "ExecutionRequest",
    "ExecutionSuccess",
    "Language",
    "NetworkMode",
    "OutputBudget",
    "RequestHandler",
    "SandboxBroker",
    "SkillMount",
    "SkillRequest",
    "SkillScope",
    "ThreadingUnixServer",
    "build_docker_command",
    "drain_stream",
    "ensure_token",
    "ensure_workspace_dir",
    "main",
    "parse_positive_int",
    "resolve_skill_mount",
    "validate_request",
]

if __name__ == "__main__":
    main()

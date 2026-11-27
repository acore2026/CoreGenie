"""Command-line interface for launching the sandbox broker daemon."""

from __future__ import annotations

import argparse
import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from .broker import SandboxBroker
from .config import (
    DEFAULT_DOCKER_BINARY,
    DEFAULT_IMAGE,
    DEFAULT_MAX_CONCURRENCY,
    DEFAULT_NO_PROXY,
    DEFAULT_RUNNER_MEMORY,
    DEFAULT_WORKSPACE_GID,
    DEFAULT_WORKSPACE_UID,
    MAX_CONCURRENCY,
    MIN_CONCURRENCY,
    BrokerConfig,
    NetworkMode,
)
from .server import ensure_token, publish_unix_socket, serve_forever

CLI_DESCRIPTION = "Narrow Docker execution broker for CoreGenie's bash and python tools."


@dataclass(frozen=True, slots=True)
class CliArgs:
    socket: Path
    token_file: Path
    workspace_root: Path
    docker_workspace_root: Path
    global_skills_root: Path
    docker_global_skills_root: Path
    image: str
    docker_binary: str
    max_concurrency: int
    runner_memory: str
    socket_uid: int
    socket_gid: int
    workspace_uid: int
    workspace_gid: int
    network: NetworkMode
    proxy_url: str | None
    no_proxy: str
    ca_bundle: Path | None
    docker_ca_bundle: Path | None


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=CLI_DESCRIPTION)
    parser.add_argument("--socket", required=True, type=Path)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--workspace-root", required=True, type=Path)
    parser.add_argument("--docker-workspace-root", required=True, type=Path)
    parser.add_argument("--global-skills-root", required=True, type=Path)
    parser.add_argument("--docker-global-skills-root", required=True, type=Path)
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    parser.add_argument("--docker-binary", default=DEFAULT_DOCKER_BINARY)
    parser.add_argument("--max-concurrency", type=int, default=DEFAULT_MAX_CONCURRENCY)
    parser.add_argument("--runner-memory", default=DEFAULT_RUNNER_MEMORY)
    parser.add_argument("--socket-uid", type=int, default=os.getuid())
    parser.add_argument("--socket-gid", type=int, default=os.getgid())
    parser.add_argument("--workspace-uid", type=int, default=DEFAULT_WORKSPACE_UID)
    parser.add_argument("--workspace-gid", type=int, default=DEFAULT_WORKSPACE_GID)
    parser.add_argument("--network", choices=("bridge", "none"), default="bridge")
    parser.add_argument("--proxy-url")
    parser.add_argument("--no-proxy", default=DEFAULT_NO_PROXY)
    parser.add_argument("--ca-bundle", type=Path)
    parser.add_argument("--docker-ca-bundle", type=Path)
    return parser


def parse_args(argv: Sequence[str] | None = None) -> CliArgs:
    ns = build_arg_parser().parse_args(argv)
    return CliArgs(
        socket=cast(Path, ns.socket),
        token_file=cast(Path, ns.token_file),
        workspace_root=cast(Path, ns.workspace_root),
        docker_workspace_root=cast(Path, ns.docker_workspace_root),
        global_skills_root=cast(Path, ns.global_skills_root),
        docker_global_skills_root=cast(Path, ns.docker_global_skills_root),
        image=cast(str, ns.image),
        docker_binary=cast(str, ns.docker_binary),
        max_concurrency=cast(int, ns.max_concurrency),
        runner_memory=cast(str, ns.runner_memory),
        socket_uid=cast(int, ns.socket_uid),
        socket_gid=cast(int, ns.socket_gid),
        workspace_uid=cast(int, ns.workspace_uid),
        workspace_gid=cast(int, ns.workspace_gid),
        network=cast(NetworkMode, ns.network),
        proxy_url=cast(str | None, ns.proxy_url),
        no_proxy=cast(str, ns.no_proxy),
        ca_bundle=cast(Path | None, ns.ca_bundle),
        docker_ca_bundle=cast(Path | None, ns.docker_ca_bundle),
    )


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    if args.max_concurrency < MIN_CONCURRENCY or args.max_concurrency > MAX_CONCURRENCY:
        raise SystemExit(
            f"--max-concurrency must be between {MIN_CONCURRENCY} and {MAX_CONCURRENCY}"
        )

    token = ensure_token(args.token_file, args.socket_uid, args.socket_gid)
    config = BrokerConfig(
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
        no_proxy=args.no_proxy,
        ca_bundle=args.ca_bundle,
        docker_ca_bundle=args.docker_ca_bundle,
    )
    broker = SandboxBroker.from_config(config)
    server, socket_inode = publish_unix_socket(
        args.socket,
        broker,
        socket_uid=args.socket_uid,
        socket_gid=args.socket_gid,
    )

    print(
        f"AnythingLLM sandbox broker listening on {args.socket} "
        f"with image {args.image} and network {args.network}",
        flush=True,
    )
    serve_forever(server, args.socket, socket_inode)

"""Workspace directory provisioning and read-only Skill mount resolution."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .config import BrokerConfig
from .protocol import BrokerError, SkillRequest


@dataclass(frozen=True, slots=True)
class SkillMount:
    """Resolved working directory and optional Docker mount flags for a Skill."""

    workdir: str
    docker_args: tuple[str, ...]


def ensure_workspace_dir(config: BrokerConfig, workspace_id: int) -> Path:
    """Create and validate a workspace directory without following symlinks."""
    config.workspace_root.mkdir(parents=True, exist_ok=True, mode=0o770)
    candidate = config.workspace_root / f"workspace-{workspace_id}"
    if candidate.is_symlink():
        raise BrokerError("workspace root must not be a symbolic link")

    candidate.mkdir(parents=True, exist_ok=True, mode=0o770)
    try:
        if os.geteuid() == 0:
            os.chown(candidate, config.workspace_uid, config.workspace_gid)
        os.chmod(candidate, 0o770)
    except PermissionError as exc:
        raise BrokerError(
            "broker cannot set writable workspace ownership"
        ) from exc

    resolved = candidate.resolve()
    if resolved.parent != config.workspace_root:
        raise BrokerError("invalid workspace path")
    return resolved


def resolve_skill_mount(
    config: BrokerConfig,
    skill: SkillRequest | None,
    workspace_path: Path,
) -> SkillMount:
    """Resolve the container workdir and bind-mount flags for an optional Skill."""
    if skill is None:
        return SkillMount(workdir="/workspace", docker_args=())

    name = skill["name"]
    scope = skill["scope"]
    if scope == "workspace":
        return _resolve_workspace_skill(name, workspace_path)

    return _resolve_managed_skill(config, skill)


def _resolve_workspace_skill(name: str, workspace_path: Path) -> SkillMount:
    skills_root = (workspace_path / ".agent" / "skills").resolve()
    candidate = skills_root / name
    if candidate.is_symlink() or not candidate.is_dir():
        raise BrokerError("workspace skill directory is unavailable")
    resolved = candidate.resolve()
    if resolved.parent != skills_root:
        raise BrokerError("invalid workspace skill path")
    return SkillMount(workdir=f"/workspace/.agent/skills/{name}", docker_args=())


def _resolve_managed_skill(config: BrokerConfig, skill: SkillRequest) -> SkillMount:
    skill_id = skill["id"]
    if skill_id is None:
        raise BrokerError("skill revision is unavailable")

    relative = Path(str(skill_id)) / "revisions" / skill["revision"]
    if skill["scope"] == "personal":
        owner_id = skill.get("ownerId")
        if owner_id is None:
            raise BrokerError("skill revision is unavailable")
        relative = Path(".personal") / str(owner_id) / relative

    candidate = config.global_skills_root / relative
    if not candidate.is_dir():
        raise BrokerError("skill revision is unavailable")

    # Personal and global packages share the read-only skill volume. Never
    # follow a symlink in any owner/id/revision component of that volume.
    current = config.global_skills_root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise BrokerError("invalid skill path")
    if candidate.resolve() != candidate:
        raise BrokerError("invalid skill path")

    docker_source = config.docker_global_skills_root / relative
    destination = f"/skills/{skill['name']}"
    return SkillMount(
        workdir=destination,
        docker_args=(
            "--mount",
            f"type=bind,src={docker_source},dst={destination},readonly",
        ),
    )

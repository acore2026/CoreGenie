"""Wire protocol types, error contract, and request validation."""

from __future__ import annotations

import hmac
import uuid
from typing import Literal, TypedDict, cast

from .config import (
    DEFAULT_QUEUE_TIMEOUT_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    INVOCATION_ID_PATTERN,
    MAX_CODE_BYTES,
    MAX_QUEUE_TIMEOUT_SECONDS,
    MAX_TIMEOUT_SECONDS,
    SKILL_NAME_PATTERN,
    SKILL_REVISION_PATTERN,
)

Language = Literal["bash", "python"]
SkillScope = Literal["global", "workspace", "personal"]


class _OptionalSkillFields(TypedDict, total=False):
    ownerId: int | None


class SkillRequest(_OptionalSkillFields):
    id: int | None
    name: str
    scope: SkillScope
    revision: str


class ExecutionRequest(TypedDict):
    language: Language
    code: str
    workspace_id: int
    invocation_id: str
    timeout_seconds: int
    queue_timeout_seconds: int
    skill: SkillRequest | None


class ExecutionSuccess(TypedDict):
    ok: Literal[True]
    exitCode: int | None
    stdout: str
    stderr: str
    timedOut: bool
    truncated: bool


class _OptionalErrorFields(TypedDict, total=False):
    code: str
    retryable: bool


class ErrorResponse(_OptionalErrorFields):
    ok: Literal[False]
    error: str


BrokerResponse = ExecutionSuccess | ErrorResponse


class BrokerError(Exception):
    """A safe, structured error that may be returned over the Unix socket."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "SANDBOX_BROKER_ERROR",
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable

    def to_response(self) -> ErrorResponse:
        return {
            "ok": False,
            "code": self.code,
            "error": str(self),
            "retryable": self.retryable,
        }


def parse_positive_int(value: object, field: str) -> int:
    """Parse a strict positive integer without accepting booleans or whitespace."""
    if isinstance(value, bool):
        raise BrokerError(f"{field} must be a positive integer")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = int(value)
        except ValueError as exc:
            raise BrokerError(f"{field} must be a positive integer") from exc
    else:
        raise BrokerError(f"{field} must be a positive integer")

    if parsed < 1 or str(parsed) != str(value):
        raise BrokerError(f"{field} must be a positive integer")
    return parsed


def _validate_token(supplied_token: object, expected_token: str) -> None:
    if not isinstance(supplied_token, str) or not hmac.compare_digest(
        supplied_token, expected_token
    ):
        raise BrokerError("unauthorized")


def _validate_language(value: object) -> Language:
    if value == "bash":
        return "bash"
    if value == "python":
        return "python"
    raise BrokerError("language must be bash or python")


def _validate_code(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BrokerError("code must be a non-empty string")
    if len(value.encode("utf-8")) > MAX_CODE_BYTES:
        raise BrokerError(f"code exceeds the {MAX_CODE_BYTES}-byte limit")
    return value


def _validate_invocation_id(raw_value: object, workspace_id: int) -> str:
    if not isinstance(raw_value, str) or not INVOCATION_ID_PATTERN.fullmatch(raw_value):
        raise BrokerError("invocationId must be a bounded run or tool-call ID")
    try:
        return str(uuid.UUID(raw_value))
    except ValueError:
        # Older clients pass provider tool-call IDs for child Agents. Map them
        # deterministically to safe container labels without requiring a restart.
        return str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"anythingllm:{workspace_id}:{raw_value}")
        )


def _validate_skill(raw_skill: object) -> SkillRequest | None:
    if raw_skill is None:
        return None
    if not isinstance(raw_skill, dict):
        raise BrokerError("skill must be an object")

    skill_dict = cast(dict[str, object], raw_skill)
    name = skill_dict.get("name")
    scope = skill_dict.get("scope")
    revision = skill_dict.get("revision")

    if not isinstance(name, str) or not SKILL_NAME_PATTERN.fullmatch(name):
        raise BrokerError("invalid skill name")
    if scope not in ("global", "workspace", "personal"):
        raise BrokerError("skill scope must be global, workspace or personal")
    if not isinstance(revision, str) or not SKILL_REVISION_PATTERN.fullmatch(revision):
        raise BrokerError("invalid skill revision")

    skill_id: int | None = None
    if scope in ("global", "personal"):
        skill_id = parse_positive_int(skill_dict.get("id"), "skill.id")

    validated: SkillRequest = {
        "id": skill_id,
        "name": name,
        "scope": scope,
        "revision": revision,
    }
    if scope == "personal":
        validated["ownerId"] = parse_positive_int(
            skill_dict.get("ownerId"), "skill.ownerId"
        )
    return validated


def validate_request(payload: object, expected_token: str) -> ExecutionRequest:
    """Validate and normalize an untrusted JSON payload from the Unix socket."""
    if not isinstance(payload, dict):
        raise BrokerError("request must be a JSON object")

    raw = cast(dict[str, object], payload)
    _validate_token(raw.get("token"), expected_token)
    language = _validate_language(raw.get("language"))
    code = _validate_code(raw.get("code"))
    workspace_id = parse_positive_int(raw.get("workspaceId"), "workspaceId")
    invocation_id = _validate_invocation_id(raw.get("invocationId"), workspace_id)

    timeout_seconds = min(
        parse_positive_int(
            raw.get("timeoutSeconds", DEFAULT_TIMEOUT_SECONDS),
            "timeoutSeconds",
        ),
        MAX_TIMEOUT_SECONDS,
    )
    queue_timeout_seconds = min(
        parse_positive_int(
            raw.get("queueTimeoutSeconds", DEFAULT_QUEUE_TIMEOUT_SECONDS),
            "queueTimeoutSeconds",
        ),
        MAX_QUEUE_TIMEOUT_SECONDS,
    )
    skill = _validate_skill(raw.get("skill"))

    return {
        "language": language,
        "code": code,
        "workspace_id": workspace_id,
        "invocation_id": invocation_id,
        "timeout_seconds": timeout_seconds,
        "queue_timeout_seconds": queue_timeout_seconds,
        "skill": skill,
    }

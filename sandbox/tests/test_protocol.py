"""Unit tests for request protocol validation."""

from __future__ import annotations

import unittest
import uuid

from sandbox_broker import BrokerError, validate_request
from tests.helpers import TEST_TOKEN, make_payload


class ProtocolValidationTests(unittest.TestCase):
    def test_accepts_narrow_request(self) -> None:
        request = validate_request(make_payload(), TEST_TOKEN)
        self.assertEqual(request["workspace_id"], 12)
        self.assertEqual(request["language"], "python")
        self.assertIsNone(request["skill"])

    def test_accepts_subagent_call_ids_and_preserves_uuid_ids(self) -> None:
        payload = make_payload()
        self.assertEqual(
            validate_request(payload, TEST_TOKEN)["invocation_id"],
            payload["invocationId"],
        )

        call_payload = make_payload(invocation_id="call_feb0e48a2b784f12a0941095")
        request = validate_request(call_payload, TEST_TOKEN)
        self.assertEqual(
            str(uuid.UUID(request["invocation_id"])),
            request["invocation_id"],
        )
        self.assertEqual(
            request["invocation_id"],
            validate_request(call_payload, TEST_TOKEN)["invocation_id"],
        )

        for invalid in (None, "", "../escape", "bad\nname", "x" * 129):
            with self.subTest(invalid=invalid), self.assertRaises(BrokerError):
                validate_request(make_payload(invocation_id=invalid), TEST_TOKEN)

    def test_rejects_bad_identity_and_language(self) -> None:
        with self.assertRaises(BrokerError):
            validate_request(make_payload(token="wrong"), TEST_TOKEN)
        with self.assertRaises(BrokerError):
            validate_request(make_payload(language="sh"), TEST_TOKEN)
        with self.assertRaises(BrokerError):
            validate_request(make_payload(workspace_id="../../root"), TEST_TOKEN)

    def test_accepts_long_jobs_and_larger_code(self) -> None:
        request = validate_request(
            make_payload(
                code="#" * (128 * 1024),
                timeout_seconds=7200,
                extra={"queueTimeoutSeconds": 120},
            ),
            TEST_TOKEN,
        )
        self.assertEqual(request["timeout_seconds"], 7200)
        self.assertEqual(request["queue_timeout_seconds"], 120)

    def test_personal_skill_rejects_invalid_owner_or_id(self) -> None:
        base_skill: dict[str, object] = {
            "scope": "personal",
            "ownerId": 7,
            "id": 9,
            "name": "personal-9",
            "revision": "a" * 64,
        }
        for key in ("ownerId", "id"):
            for value in (None, 0, -1, "../7", True):
                with self.subTest(key=key, value=value), self.assertRaises(BrokerError):
                    validate_request(
                        make_payload(extra={"skill": {**base_skill, key: value}}),
                        TEST_TOKEN,
                    )

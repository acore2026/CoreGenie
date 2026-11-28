import { expect, test } from "vitest";
import {
  conversationRuntimeKey,
  getConversationRuntime,
  initializeConversationRuntime,
} from "./conversationRuntime";

test("a shared workspace keeps each account’s conversation and stream state separate", () => {
  const first = conversationRuntimeKey("shared", null, 1);
  const second = conversationRuntimeKey("shared", null, 2);
  initializeConversationRuntime(first, [
    { role: "user", content: "first account" },
  ]);
  expect(getConversationRuntime(second)).toBeNull();
  expect(
    getConversationRuntime(conversationRuntimeKey("shared", null, 1))?.history
  ).toHaveLength(1);
  expect(conversationRuntimeKey("shared", "__default__", 1)).not.toBe(first);
});

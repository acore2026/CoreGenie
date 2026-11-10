import test from "node:test";
import assert from "node:assert/strict";
import {
  activityText,
  toolActivityText,
  userFacingErrorKey,
  isInternalDiagnostic,
} from "./userFacingError.mjs";

test("recovered tool failures never render raw errors or failed result summaries", () => {
  for (const status of ["failed", "cancelled", "retrying"])
    assert.equal(
      toolActivityText({ status, result_summary: "HTTP request unsuccessful" }),
      null
    );
  assert.equal(
    toolActivityText({
      status: "completed",
      error: "secret stack",
      result_summary: "done",
    }),
    null
  );
  for (const value of [
    "Error: ECONNRESET /app/server/tools.js:12",
    '{"error":"bad request"}',
    "解析失败，正在重试",
    "Traceback (most recent call last):",
  ])
    assert.equal(activityText(value), null);
});
test("successful useful activity stays visible", () => {
  assert.equal(
    toolActivityText({
      status: "completed",
      result_summary: "已保存 36 份提案",
    }),
    "已保存 36 份提案"
  );
  assert.equal(activityText("已读取会议清单"), "已读取会议清单");
});

test("technical toast errors are detected without discarding useful validation messages", () => {
  assert.equal(isInternalDiagnostic("TypeError at /app/server/db.js"), true);
  assert.equal(isInternalDiagnostic("文件不能超过 20 MB"), false);
  assert.equal(isInternalDiagnostic("分组名称已存在，请换个名称"), false);
});
test("fatal errors map to actionable copy keys without returning raw diagnostics", () => {
  assert.equal(
    userFacingErrorKey("ECONNRESET http://internal-service"),
    "user_error.connection"
  );
  assert.equal(
    userFacingErrorKey("401 invalid api key secret"),
    "user_error.access"
  );
  assert.equal(userFacingErrorKey("429 rate limit"), "user_error.busy");
  assert.equal(
    userFacingErrorKey("context length exceeded"),
    "user_error.context"
  );
  assert.equal(userFacingErrorKey("insufficient balance"), "user_error.quota");
  assert.equal(
    userFacingErrorKey("stack details /root/private/file"),
    "user_error.incomplete"
  );
});

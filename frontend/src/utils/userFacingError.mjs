// Operational details belong in diagnostics, not in the conversation UI.
export function isInternalDiagnostic(value) {
  return (
    typeof value === "string" &&
    /\b(?:ECONN\w*|ENOTFOUND|ETIMEDOUT|EACCES|ENOENT)\b|traceback|stack trace|\b(?:TypeError|ReferenceError|SyntaxError|Prisma\w*Error)\b|node_modules|\/app\/server|\/root\/|fetch failed|\bat \S+ \([^\n]+:\d+:\d+\)/i.test(
      value
    )
  );
}

export function userFacingErrorKey(error) {
  const text = typeof error === "string" ? error : "";
  if (/quota|insufficient.*(?:credit|balance)|余额|配额/i.test(text))
    return "user_error.quota";
  if (
    /401|403|unauthori[sz]ed|forbidden|permission denied|无权|权限不足/i.test(
      text
    )
  )
    return "user_error.access";
  if (
    /context.{0,20}(?:length|window)|too many tokens|上下文.*(?:超|长)/i.test(
      text
    )
  )
    return "user_error.context";
  if (/429|rate.?limit|too many requests/i.test(text)) return "user_error.busy";
  if (
    /timeout|timed out|ECONN|ENOTFOUND|fetch failed|network|502|503|504|网络|超时/i.test(
      text
    )
  )
    return "user_error.connection";
  return "user_error.incomplete";
}

export function activityText(value) {
  if (typeof value !== "string") return null;
  // These fields are tool/progress metadata, never the user's final answer.
  if (
    /\berror\b|exception|traceback|stack trace|ECONN\w*|ENOTFOUND|ETIMEDOUT|fetch failed|\b(?:failed|failure)\b|node_modules|\/app\/server|\/root\/|错误|失败|未成功|重试/i.test(
      value
    )
  )
    return null;
  return value;
}

export function toolActivityText(tool) {
  if (
    !tool ||
    tool.error ||
    ["failed", "cancelled", "retrying"].includes(tool.status)
  )
    return null;
  return activityText(tool.result_summary);
}

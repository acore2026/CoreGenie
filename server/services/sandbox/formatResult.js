function formatResult(result, timeoutSeconds = null) {
  const sections = [`Exit code: ${result.exitCode}`];
  if (result.timedOut) {
    sections.push(
      timeoutSeconds
        ? `Timed out after ${timeoutSeconds} seconds.`
        : "Timed out before completion."
    );
  }
  if (result.stdout) sections.push(`stdout:\n${result.stdout}`);
  if (result.stderr) sections.push(`stderr:\n${result.stderr}`);
  if (!result.stdout && !result.stderr)
    sections.push("The command completed without output.");
  if (result.truncated)
    sections.push("[Output truncated at the sandbox output limit]");
  return sections.join("\n\n");
}

module.exports = { formatResult };

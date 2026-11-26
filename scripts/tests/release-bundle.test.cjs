const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
test("application and broker versions match the release and agent configs are copied", () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version;
  for (const file of ["docker/Dockerfile", "sandbox/Dockerfile.broker"])
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), new RegExp("ENV DEPLOYMENT_VERSION=" + version.replaceAll(".", "\\.") + "(?:\n|$)"));
  assert.ok(fs.readFileSync(path.join(root, "scripts/deploy-existing-container.cjs"), "utf8").includes("// CoreGenie deployment helper version: " + version));
  const dockerfile = fs.readFileSync(path.join(root, "docker/Dockerfile"), "utf8");
  assert.ok(dockerfile.includes("./agent-config/ /app/agent-config/"));
  assert.ok(fs.existsSync(path.join(root, "agent-config/commands/workspace-clean.json")));
});

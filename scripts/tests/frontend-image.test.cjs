const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertFrontendOnly, validateBase } = require("../prepare-frontend-image.cjs");
const base = () => ({
  os: "linux", architecture: "amd64",
  config: { Env: ["DEPLOYMENT_VERSION=1.15.5"], Labels: { "org.opencontainers.image.revision": "a".repeat(40) } },
});
test("allows frontend source, dependencies and quick-build infrastructure", () => {
  assert.doesNotThrow(() => assertFrontendOnly(["frontend/src/index.jsx", "frontend/yarn.lock", "docs/frontend-images.md", "docker/Dockerfile.frontend", ".github/workflows/build-and-push-image-frontend.yaml"]));
});
for (const file of ["server/index.js", "server/contracts/agent.ts", "server/prisma/schema.prisma", "server/yarn.lock", "collector/package.json", "agent-config/agents.json", "sandbox/broker.py", "docker/Dockerfile", "package.json"]) {
  test("blocks incompatible change: " + file, () => assert.throws(() => assertFrontendOnly([file]), /full image workflow/));
}
test("cross-boundary renames are blocked when git reports both names", () => {
  assert.throws(() => assertFrontendOnly(["server/old.js", "frontend/new.js"]), /full image workflow/);
});
test("accepts a matching full release with a recorded source commit", () => {
  assert.equal(validateBase(base(), "1.15.5"), "a".repeat(40));
});
test("rejects a mismatched version", () => assert.throws(() => validateBase(base(), "1.15.6"), /version/));
test("rejects an unknown source commit", () => {
  const config = base(); delete config.config.Labels["org.opencontainers.image.revision"];
  assert.throws(() => validateBase(config, "1.15.5"), /source commit/);
});
test("rejects another architecture", () => {
  const config = base(); config.architecture = "arm64";
  assert.throws(() => validateBase(config, "1.15.5"), /linux\/amd64/);
});
test("rejects chained frontend patches", () => {
  const config = base(); config.config.Labels["io.coregenie.frontend-only"] = "true";
  assert.throws(() => validateBase(config, "1.15.5"), /full release/);
});

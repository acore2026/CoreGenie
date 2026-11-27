const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const infrastructure = new Set([
  ".github/workflows/build-and-push-image-frontend.yaml",
  "docker/Dockerfile.frontend",
  "scripts/prepare-frontend-image.cjs",
  "scripts/tests/frontend-image.test.cjs",
]);

function assertFrontendOnly(files) {
  const blocked = files.filter(file =>
    !file.startsWith("frontend/") && !file.endsWith(".md") && !infrastructure.has(file)
  );
  if (blocked.length) throw new Error("Use the full image workflow: non-frontend changes since the base image:\n" + blocked.join("\n"));
}
function validateBase(config, version) {
  const revision = config.config?.Labels?.["org.opencontainers.image.revision"];
  if (config.os !== "linux" || config.architecture !== "amd64")
    throw new Error("Base image must be linux/amd64.");
  if (!/^[a-f0-9]{40}$/.test(revision || ""))
    throw new Error("Base image is missing its source commit.");
  if (!config.config?.Env?.includes("DEPLOYMENT_VERSION=" + version))
    throw new Error("Base image version does not match the requested release.");
  if (config.config?.Labels?.["io.coregenie.frontend-only"] === "true")
    throw new Error("Use a full release as the base, not another frontend patch.");
  return revision;
}
function main() {
  const version = process.argv[2];
  const repository = (process.env.GITHUB_REPOSITORY || "acore2026/CoreGenie").toLowerCase();
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw new Error("Pass a full release version, e.g. 1.15.5.");
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(repository)) throw new Error("Invalid repository.");
  const run = (tool, args) => execFileSync(tool, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
  const inspect = (ref, object) => JSON.parse(run("docker", ["buildx", "imagetools", "inspect", ref, "--format", "{{json ." + object + "}}"]));
  const image = "ghcr.io/" + repository;
  const manifest = inspect(image + ":" + version, "Manifest");
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.digest || "")) throw new Error("Base image digest missing.");
  const baseImage = image + "@" + manifest.digest;
  const baseRevision = validateBase(inspect(baseImage, "Image"), version);
  run("git", ["merge-base", "--is-ancestor", baseRevision, "HEAD"]);
  const changed = run("git", ["diff", "--name-only", "--no-renames", "-z", baseRevision, "HEAD"]).split("\0").filter(Boolean);
  assertFrontendOnly(changed);
  if (!changed.some(file => file.startsWith("frontend/"))) throw new Error("No frontend changes to publish.");
  const revision = run("git", ["rev-parse", "HEAD"]);
  const patchVersion = version + "-ui." + revision.slice(0, 8);
  const values = { base_image: baseImage, base_revision: baseRevision, image, revision, version: patchVersion };
  const output = Object.entries(values).map(([key,value]) => key + "=" + value).join("\n") + "\n";
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assertFrontendOnly, validateBase };

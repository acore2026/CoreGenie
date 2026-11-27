#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findTsc() {
  for (const candidate of [
    path.join(root, "node_modules/typescript/bin/tsc"),
    path.join(root, "frontend/node_modules/typescript/bin/tsc"),
    path.join(root, "server/node_modules/typescript/bin/tsc"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("TypeScript compiler (tsc) not found.");
}

const tsc = findTsc();
const projects = process.argv.slice(2);
const targets = projects.length
  ? projects
  : ["server/tsconfig.json", "frontend/tsconfig.json"];

for (const project of targets) {
  const fullPath = path.resolve(root, project);
  console.log(`Typechecking ${project}...`);
  const result = spawnSync(process.execPath, [tsc, "--project", fullPath], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

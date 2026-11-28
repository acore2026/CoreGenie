// Existing JavaScript remains linted while business modules migrate to TypeScript.
import { execFileSync } from "node:child_process";

const roots = ["frontend/src", "collector", "server"];
const base = process.env.SOURCE_BASE || "HEAD";
function gitFiles(args: string[]): string[] {
  return execFileSync("git", [...args, "--", ...roots], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}
const added = [
  ...gitFiles([
    "diff",
    "--name-only",
    "-z",
    "--diff-filter=A",
    "--no-renames",
    base,
  ]),
  ...gitFiles(["ls-files", "-z", "--others", "--exclude-standard"]),
];
const legacy = added.filter(
  (file) =>
    /\.(js|jsx|mjs|cjs)$/.test(file) && !/\.config\.(m?js|cjs)$/.test(file)
);
if (legacy.length) {
  console.error("新增业务代码请使用 TypeScript：\n" + legacy.join("\n"));
  process.exitCode = 1;
}

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const collectorRoot = dirname(
  fileURLToPath(import.meta.resolve("@coregenie/collector/package.json"))
);

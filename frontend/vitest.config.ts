import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const localPath = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": localPath("./src"),
      "@coregenie/contracts": localPath("../packages/contracts/src"),
      "@help-docs": localPath("../docs/help"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx,js,mjs}"],
  },
});

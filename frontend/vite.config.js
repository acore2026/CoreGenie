import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite"
import { fileURLToPath } from "node:url"
import postcss from "./postcss.config.js"
import react from "@vitejs/plugin-react"
import { visualizer } from "rollup-plugin-visualizer"

const localPath = (relative) =>
  fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    visualizer({
      template: "treemap",
      gzipSize: true,
      filename: "bundleinspector.html"
    })
  ],
  envPrefix: [],
  define: {
    "import.meta.env.VITE_API_BASE": JSON.stringify(
      loadEnv(mode, localPath("."), "VITE_API_BASE").VITE_API_BASE || ""
    )
  },
  worker: { format: "es" },
  server: {
    port: 3000,
    host: "localhost",
    fs: {
      allow: [
        searchForWorkspaceRoot(localPath(".")),
        localPath("../server/contracts")
      ]
    }
  },
  css: { postcss },
  resolve: {
    alias: { "@": localPath("./src") },
    dedupe: ["zod"]
  },
  build: {
    rolldownOptions: {
      external: [/@phosphor-icons\/react\/dist\/ssr/],
      output: {
        // The Node server serves the generated HTML and these stable entry assets.
        entryFileNames: "index.js",
        assetFileNames: "[name][extname]"
      }
    }
  }
}))

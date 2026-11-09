// A loopback-only preview of the real tool component. No backend or API mocks.
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const entry = "\0coregenie-local-tools-preview.js";
const html =
  '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CoreGenie</title></head><body><div id="root"></div><script type="module" src="/@id/__x00__coregenie-local-tools-preview.js"></script></body></html>';
const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.js"),
  server: { host: "127.0.0.1", port: 3000, strictPort: true },
  plugins: [
    {
      name: "local-tools-preview",
      resolveId(id) {
        if (id === entry) return entry;
      },
      load(id) {
        if (id !== entry) return;
        return `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { I18nextProvider } from "react-i18next";
        import { ThemeProvider } from "/src/ThemeContext.jsx";
        import i18n from "/src/i18n.js";
        import LocalTools from "/src/pages/LocalTools/index.jsx";
        import "/src/index.css";
        document.title = i18n.t("local_tools.title");
        createRoot(document.getElementById("root")).render(
          React.createElement(ThemeProvider, null,
            React.createElement(I18nextProvider, { i18n },
              React.createElement(LocalTools, { standalone: true })))
        );
      `;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          const pathname = request.url?.split("?")[0];
          if (pathname === "/") {
            response.writeHead(302, { Location: "/tools" });
            response.end();
            return;
          }
          if (pathname !== "/tools" && pathname !== "/tools/") return next();
          try {
            const page = await vite.transformIndexHtml("/tools", html);
            response.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            response.end(page);
          } catch (error) {
            vite.ssrFixStacktrace(error);
            console.error(error);
            response.writeHead(500);
            response.end();
          }
        });
      },
    },
  ],
});
await server.listen();
console.log("Local tools: http://localhost:3000/tools");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });

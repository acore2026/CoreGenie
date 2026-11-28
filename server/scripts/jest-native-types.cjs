// Jest 29 runs modules in its own VM. Match Node 24's native TS type-stripping there.
const path = require("path");

function loadTypeScript() {
  for (const candidate of [
    "typescript",
    path.resolve(__dirname, "../../frontend/node_modules/typescript"),
  ]) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error(
    "TypeScript compiler not found. Run pnpm install at the workspace root."
  );
}

const ts = loadTypeScript();

module.exports = {
  process(source, filename) {
    return {
      code: ts.transpileModule(source, {
        // Jest 29 loads required .mts contracts in its CommonJS VM.
        fileName: filename.replace(/\.mts$/, ".ts"),
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      }).outputText,
    };
  },
};

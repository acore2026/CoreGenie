// Jest 29 runs modules in its own VM. Match Node 24's native TS loading there.
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
    "TypeScript compiler not found. Run yarn install in root or frontend."
  );
}

const ts = loadTypeScript();

module.exports = {
  process(source) {
    return {
      code: ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      }).outputText,
    };
  },
};

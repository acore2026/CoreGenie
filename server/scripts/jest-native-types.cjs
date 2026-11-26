// Jest 29 runs modules in its own VM. Match Node 24's native TS loading there.
const ts = require("typescript");

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

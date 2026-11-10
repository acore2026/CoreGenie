# 提案编号回填工具

工具使用 TypeScript，Word 和 Excel 文件在浏览器中处理。

- `types.ts`：CR 提案、会议清单、匹配结果、修改计划和导出文件的类型。
- `proposalFill.ts`：读取文件、匹配记录、生成修改计划和导出副本。
- `../../pages/LocalTools/`：工具目录和操作页，使用 TSX。

目前只支持 CR 提案。迁移到 TypeScript 不增加普通提案或自动下载清单的功能。
后续增加提案类型时，应根据 `kind` 分别定义字段和处理规则，不把普通提案当成 CR。

在 `frontend/` 运行：

```bash
yarn typecheck:tools
yarn test:proposal-fill
yarn build
```

`tsconfig.tools.json` 对工具启用严格类型检查，现有 JavaScript 模块保留原有检查方式。
`yarn build` 会先执行工具类型检查；类型错误会阻止构建。
浏览器测试首次运行前需安装 Playwright Chromium，或设置
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已有 Chrome。

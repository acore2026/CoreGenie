# 提案编号回填工具

工具使用 TypeScript，Word 和 Excel 文件在浏览器中处理。官网下载由已登录的服务端从 3GPP 官方目录读取，不上传 Word。

- `types.ts`：CR 和普通技术提案、会议清单、匹配结果、修改计划和导出文件的类型。
- `ooxml.ts`：浏览器端 ZIP / OOXML 通用读写、简单 `.xlsx` 构建和下载辅助。
- `apiImpactCr.ts`：解析 `API_impacts_TSGCT.xlsx` 与可选规范基线 `.docx`/`.yaml`，按 TS 29.501 规则计算版本号并生成 `CR-Form-v13.0.1` Word 文档。
- `tdocAllocation.ts`：从 CR 与普通 Word 提案提取封面元数据，导出 21 列 `Template_Bulk_TDoc_Allocation.xlsx`。
- `proposalFill.ts`：读取文件、匹配记录、生成修改计划和导出副本。
- `../../pages/LocalTools/`：工具目录和操作页（`ApiCrGenerator.tsx`、`TdocAllocation.tsx`、`index.tsx`、`ProtocolFinder.tsx`），使用 TSX。

支持 CR-Form-v13.0.1，以及首页段落或表格标注 Title、Source 的普通提案。
CR 更新 TDoc、CR、rev、Current version；普通提案只更新 TDoc，保留正文及版本号。
普通提案仅按其首页已有元数据匹配，缺少的 Spec/Release 不用于筛选；同标题多条记录需人工选择。
待修改编号必须能在文档开头唯一定位；历史引用、正文、图片和嵌入对象保留。

`meetingDownload.ts` 和 `MeetingDownload.tsx` 支持选择工作组和会议，再下载官方清单。
下载清单时默认选择已开始的最近会议。只有年月的当月会议、日期缺失或无效的会议，需要手动选择。Agent 的会议选择器按本地日期推断当前和下一场会议，当月只有年月时按月初计算。两处共用日期解析。
服务端仅接受工作组和会议 ID，不接受任意 URL，并复用官方地址、重定向和 8 MB 下载限制。
官网不可用时保留当前清单，可继续手动上传。缓存会议会明确标记。
下载的清单需包含 TDoc_List 工作表；尚未发布清单的会议无法自动导入。

在 `frontend/` 运行：

```bash
yarn typecheck
node --test src/utils/meetingSelection.test.ts
yarn test:proposal-fill
yarn build
```

`tsconfig.json` 对工具启用严格类型检查，现有 JavaScript 模块保留原有检查方式。
`yarn build` 会先检查已迁移的 TypeScript 模块，类型错误会阻止构建。
浏览器测试首次运行前需安装 Playwright Chromium，或设置
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已有 Chrome。

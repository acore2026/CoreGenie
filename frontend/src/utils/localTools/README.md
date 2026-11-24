# 提案编号回填工具

工具使用 TypeScript，Word 和 Excel 文件在浏览器中处理。官网下载由已登录的服务端从 3GPP 官方目录读取，不上传 Word。

- `types.ts`：CR 和普通技术提案、会议清单、匹配结果、修改计划和导出文件的类型。
- `proposalFill.ts`：读取文件、匹配记录、生成修改计划和导出副本。
- `../../pages/LocalTools/`：工具目录和操作页，使用 TSX。

支持 CR-Form-v13.0.1，以及首页段落或表格标注 Title、Source 的普通提案。
CR 更新 TDoc、CR、rev、Current version；普通提案只更新 TDoc，保留正文及版本号。
普通提案仅按其首页已有元数据匹配，缺少的 Spec/Release 不用于筛选；同标题多条记录需人工选择。
待修改编号必须能在文档开头唯一定位；历史引用、正文、图片和嵌入对象保留。

`meetingDownload.ts` 和 `MeetingDownload.tsx` 支持选择工作组和会议，再下载官方清单。
默认选择有日期且已开始的最近会议；无日期时不推断，要求用户选择。
服务端仅接受工作组和会议 ID，不接受任意 URL，并复用官方地址、重定向和 8 MB 下载限制。
官网不可用时保留当前清单，可继续手动上传。缓存会议会明确标记。
下载的清单需包含 TDoc_List 工作表；尚未发布清单的会议无法自动导入。

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

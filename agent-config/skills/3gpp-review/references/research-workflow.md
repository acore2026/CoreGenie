## Environment

资料下载必须使用 `3gpp.download` Tool。不要用 Bash、Python、curl、unzip 或 `3gpp_tdocs.py download` 直接下载会议 Index 或 TDoc；这些脚本只由 Tool 在受控临时目录中调用。

Tool 完成后，使用它返回的准确路径。最终资料按以下结构保存：

```text
/workspace/3gpp/<会议>-<KI>/
  proposal/       # DOCX、Markdown 和 Markdown 必需的图片/嵌入对象
  analysis/       # 逐篇分析和最终报告
```

Index、ZIP、转换摘要属于中间资料，不能写入上述交付目录。临时转换放在 `/workspace/tmp/3gpp/<run-id>/`；工具在会议目录保留 `tdoc-manifest.json`，在 `_meta/tasks/` 保存来源、读取时间、失败和待上传项。不要删除这些记录。工具返回的 recordPath 是下载记录，不是 coverage 凭据。

如果用户只提供会议和 KI，直接调用：

```json
{
  "group": "SA2",
  "meeting": "SA2#176",
  "ki": ["KI18"]
}
```

同号 KI 可能属于不同研究项目。知道 TR/TS 时提供 `spec`，例如 `23.801-01`；已经由官方资料确认议程映射时可同时提供 `agenda_item`，例如 `20.6.2`，此时一次只处理一个 KI。不要根据议程编号末位猜 KI。

Tool 每次重新读取准确会议的 Docs 目录，优先使用其中对应会议的 `TDoc_List_Meeting_*.xlsx`，按 Spec、议程项筛选，再核对实际 ZIP。标题不含 TR/TS 时仍以表中的 Spec 列区分项目。不会只因 agenda 尚未更新就漏掉表中已上传的提案，也不会按相似文件名改用其他会议或共享同步目录。

TDoc 表缺失或无法解析时，Tool 退回当前官方议程，仍可下载其中已知提案，但会返回来源错误和范围提示。返回 `AMBIGUOUS_KI`、`KI_SCOPE_NOT_FOUND` 或 `AMBIGUOUS_MEETING` 时先核对项目和会议，不要重复相同参数、猜编号或扩大到整场会议。

## 资料准备后的检查

检查 Tool 返回的每个 TDoc：编号、标题、来源、文件路径和状态是否合理。下载失败保留成功项，但最终回复必须列出失败项和原因。只有所有预期 TDoc 都有可读取的 DOCX、Markdown 和必要资源，才可以声称资料准备完整。

报告结果时必须区分：

- **已下载**：DOCX、Markdown 和必要资源已完成；修订稿保留，撤回稿按 `withdrawn` 标记单独说明，不把 available 说成会议已采纳。
- **仅预留未上传**：`pendingDocuments` 中的文档已分配编号，但 Docs 尚无 ZIP。这些不属于网络下载失败，也不能算下载完成。
- **未完成**：`failures` 保留具体 TDoc 和错误。清单已列出但 Docs 没有 ZIP、下载失败、转换失败分别说明；重试复用成功项。
- **清单未列出**：`no_matching_documents_in_source` 仅表示当前读取的清单无匹配记录，不能说“尚未发布”。

`warnings`、`sourceErrors` 或 `unindexedTdocs` 非空时必须说明：清单读取失败，或 Docs 有 ZIP 尚未进入清单，无法确认是否属于当前 KI。不要忽略这些提示，也不要为了补齐数量把未确认归属的文件混入。`DOWNLOAD_INCOMPLETE` 需要说明待上传或未确认的范围，即使 `ok: true` 也不能直接报告全部完成。

数量以 `fileCount`、`failureCount`、`pendingDocumentCount` 为准。工具返回的文件和错误可能只展示部分；任何 `*Truncated` 为 true 时，读取 `recordPath` 中的完整记录再逐篇分析或列出失败项，不能把示例列表当全部结果。该记录也保留本次筛选的提案元数据，后续刷新不会覆盖旧记录。

`selectionSource` 区分 TDoc 表和议程来源；报告注明来源及 `fetchedAt` 读取时间。`completeness: unknown` 表示不保证覆盖 Inbox 草稿、尚未分配议程项的文档、后续上传或整个 KI。工具不递归下载 Inbox；用户要求包含草稿时，说明当前工具未覆盖的部分。`tdoc-manifest.json` 使用 `3gpp-download-selection/v1`，是本次下载选择记录，不是严格 coverage 凭据。不要将 source URL 当公司署名，也不要将清单或下载记录改造成严格 coverage。需要更完整的范围时先检查实际官方资料；无法确认的部分直接列为缺失。

工具当前支持 SA1、SA2、SA3、SA5、CT1、CT4，KI 必填。meeting 接受 `SA2#177`、准确官方目录名或 URL；加会使用目录列表返回的准确 id 或 source，不用简称猜目录。其他组和整场会议下载不应伪装成受支持。KI 编号必须连同研究项目/TR 和版本理解；同号 KI 的多个研究项目不合并下载。分析阶段复用实际文件；重新下载仍调用 Tool。

## 提取和图表核验

Markdown 中应保留段落、表格、原图、嵌入对象以及 `[INS:...]`、`[DEL:...]` 等修订标记。图表文字可以作为证据，但不能仅凭附近文字推断拓扑或箭头方向。

对影响架构或流程结论的图片，使用 `vision.inspect` 检查。看不清的图片直接标记不确定，不补画、不改写成 Mermaid。

## 逐篇分析

每篇提案至少记录：

- TDoc 编号、标题、来源和状态；
- 对应 KI、Solution/Variant（仅在原文明确时记录）；
- 网络功能、接口、标识和信息元素变化；
- 流程步骤和图表依据；
- 对 TR/TS 的修改建议；
- 编辑意见、假设、未决问题和与其他提案的关系。

流程统一写成“发送方 → 接收方、消息、目的”，不把推断写成原文事实。

## 报告和发布

逐篇报告写入：

```text
/workspace/3gpp/<会议>-<KI>/analysis/<TDoc>.md
```

最终汇总写入同一目录的 `summary.md`。报告至少包含范围、资料覆盖、方案/Variant、公司立场、会议结果、未决问题和参考资料。

只有用户要求入库时才调用 `knowledge.publish`。发布时提供完整 TDoc 清单、实际来源路径和检查结果；资料不完整时保留部分报告并明确缺失项，不声称完成完整覆盖。

## 已提供本地资料

用户已经上传 DOCX 或给出 Workspace 中的准确路径时，直接调用 `3gpp.convert-markdown` 或读取现有文件，不为补齐官方 Index 扩大范围。无法核验会议元数据时明确说明。

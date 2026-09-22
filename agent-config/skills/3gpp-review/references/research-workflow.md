## Environment

资料下载必须使用 `3gpp.download` Tool。不要用 Bash、Python、curl、unzip 或 `3gpp_tdocs.py download` 直接下载会议 Index 或 TDoc；这些脚本只由 Tool 在受控临时目录中调用。

Tool 完成后，使用它返回的准确路径。最终资料按以下结构保存：

```text
/workspace/3gpp/<会议>-<KI>/
  proposal/       # DOCX、Markdown 和 Markdown 必需的图片/嵌入对象
  analysis/       # 逐篇分析和最终报告
```

Index、ZIP、转换摘要、manifest、coverage 和日志属于中间资料，不能写入上述交付目录。它们只允许出现在 `/workspace/tmp/3gpp/<run-id>/` 或 `_meta/tasks/`，任务结束后清理临时目录。

如果用户只提供会议和 KI，直接调用：

```json
{
  "group": "SA2",
  "meeting": "SA2#176",
  "ki": ["KI18"]
}
```

Tool 会解析官方会议、议程和 TDoc，失败时返回 `KI_NOT_FOUND`、`KI_TDOC_NOT_FOUND` 或 `AGENDA_NOT_AVAILABLE`。不要因为 KI 映射失败而扩大到整场会议，也不要猜测议程编号。

## 资料准备后的检查

检查 Tool 返回的每个 TDoc：编号、标题、来源、文件路径和状态是否合理。下载失败保留成功项，但最终回复必须列出失败项和原因。只有所有预期 TDoc 都有可读取的 DOCX、Markdown 和必要资源，才可以声称资料准备完整。

`3gpp.download` 负责 Index 筛选、下载、解压、DOCX 转换和最终目录整理；分析阶段不重复下载，也不重新生成另一份 manifest。需要重新下载时，只调用 Tool 并复用相同的会议-KI目录。

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

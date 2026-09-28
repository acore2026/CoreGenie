## Environment

资料下载必须使用 `3gpp.download` Tool。不要用 Bash、Python、curl、unzip 或 `3gpp_tdocs.py download` 直接下载会议 Index 或 TDoc；这些脚本只由 Tool 在受控临时目录中调用。

Tool 完成后，使用它返回的准确路径。最终资料按以下结构保存：

```text
/workspace/3gpp/<会议>-<KI>/
  proposal/       # DOCX、Markdown 和 Markdown 必需的图片/嵌入对象
  analysis/       # 逐篇分析和最终报告
```

Index、ZIP、转换摘要属于中间资料，不能写入上述交付目录。临时转换放在 `/workspace/tmp/3gpp/<run-id>/`；来源记录、失败明细、manifest、coverage 和被报告引用的资料保存到 `_meta/tasks/<run-id>/`，不能随临时文件一起删除。工具返回的 recordPath 是下载记录，不是 coverage 凭据。

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

`3gpp.download` 当前负责议程引用筛选、下载、解压、DOCX 转换和目录整理，尚未实现完整 Index 筛选。`completeness: unknown` 表示集合完整性未确认，即使下载全部成功也不能宣称覆盖整个 KI。不要将其 source URL 当公司署名、将下载成功当会议采纳状态，或用议程清单生成严格 coverage。需要完整范围时先查看官方 Index/会议结果；工具不能补齐的范围直接列为缺失，或请求用户提供资料。

工具当前支持 SA1、SA2、SA3、SA5、CT1、CT4，会议输入为不带后缀的具体会议号，KI 必填。其他组、带后缀的会议、整场会议下载不应伪装成受支持。KI 编号必须连同研究项目/TR 和版本理解；议程中存在同号 KI 的多个研究项目时先确认映射，不合并下载。分析阶段复用实际文件；重新下载仍调用 Tool。

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

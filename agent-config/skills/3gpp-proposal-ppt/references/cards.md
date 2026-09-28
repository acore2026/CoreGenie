# 提案分析卡片

读取 review 提取器输出的 `*.source.json`：它包含原 DOCX 和正文文件的路径与 SHA-256、正文块及图片位置。用 `sha256sum` 或 Python hashlib 计算实际哈希，不填示例值。所有路径使用工具返回的绝对路径。

下面是字段示例，不是可直接执行的真实提案。`code` 必须与 source index 的 `document` 完全一致；来源公司、标题、规范、条款取自原文，缺失字段写“原文未注明”，不要从文件名猜公司。

```json
{
  "schema": "3gpp-proposal-cards/v1",
  "title": "指定提案技术讨论",
  "meeting": "用户提供的本地资料，会议状态未核实",
  "sources": [{"path": "/workspace/task/texts/S2-000000.source.json", "sha256": "实际哈希"}],
  "proposals": [{
    "code": "S2-000000",
    "company": "原文署名",
    "title": "原文标题",
    "kind": "贡献稿",
    "spec": "原文未注明",
    "clauses": [],
    "summary": {
      "text": "提案方建议的具体变化。",
      "evidence": [{"code": "S2-000000", "locator": "BLOCK: 3 p", "quote": "该块中逐字摘录的原文"}]
    },
    "points": [{
      "title": "关键机制",
      "claims": [{"text": "根据原文解释机制。", "evidence": [{"code": "S2-000000", "locator": "BLOCK: 3 p", "quote": "该块中逐字摘录的原文"}]}],
      "image": {"id": "word/media/image1.png", "locator": "BLOCK: 4 p", "caption": "图 1（原文）", "readability": "readable"},
      "table": {"headers": ["字段", "值"], "rows": [["原文字段", "原文值"]], "evidence": [{"code": "S2-000000", "locator": "BLOCK: 5 tbl", "quote": "该表格块中的原文"}]}
    }],
    "watch": [],
    "dataChecks": []
  }],
  "synthesis": [],
  "failures": []
}
```

- `summary`、每项 `claims`、`watch` 和 `synthesis` 都使用 `{text, evidence}`。提案内引用只指向本篇；综合分析可跨篇，每项结论引用实际支持它的资料。多篇时必须提供综合分析，不能把“涉及同一术语”直接写成公司已达成共识。
- 批量汇报可在 `synthesis` 项中增加 `table`，字段与信息点内表格相同，引用可以跨篇。适合比较提案号、来源、条款、机制和待讨论问题；仅列实际可比的维度，资料不足直接说明，不强行填满表格。
- `image`、`table` 可省略。图片 id 和 locator 必须来自本篇 source index；表内图片也能定位。转换预览时增加 `preview: {path, sha256}`，id 仍指向原图。预览应来自该原图并逐张检查；脚本检查文件及映射，不证明转换内容等价。无法辨认填 `unreadable`，脚本会生成说明页。
- 原文有关键新增图表时优先采用。不要因为提取出很多图片就全部放入 PPT，也不要只写一句摘要而省略决定理解的流程图。
- `dataChecks` 每项为 `{value, unit, condition, evidence, status}`，status 为 `verified`、`unverified` 或 `conflict`。单位确实不适用时写“无单位”；不能遗漏样本范围和实验条件。未确认或有冲突的数字会形成提示页，不会被自动改成正确。
- `failures` 每项为 `{code, reason}`，包含提取失败、缺失或未分析的用户输入。每个已加载 source index 必须有一张卡片或失败记录。脚本无法知道没有提供给它的输入，Agent 仍须与用户选择清单逐项比对。
- 当前脚本每页放至多两条分析文字，短说明与原图左右排列，放不下时分到独立文字页；表格每六行分页。超长标题、段落或单元格会明确拒绝构建；拆成多个信息点或缩短表达后重试，不静默截断。已有源图和卡片保持不变。

## 复用范围

这些卡片可以作为报告或 PPT 的分析中间结果；报告按需引用它们。不要把卡片当作新的原始资料，也不要强制所有简短提案问答都先生成卡片。特征矩阵继续使用自己的立场记录格式，避免由 PPT 的文字摘要反推支持或反对。

---
archived: false
name: 3gpp-doc2md
description: 批量将工作区中的 3GPP DOCX 提案转换为带原图和嵌入对象的 Markdown 包。用于批量格式转换，不自动归档、总结或入库；单文件转换使用 3gpp-review 的 conversion mode。
allowed-tools: skill.read_resource 3gpp.convert-markdown bash python filesystem.read filesystem.write filesystem.list filesystem.search user.ask
---

# 批量提案转换

本 Skill 负责批次选择、结果汇总和失败重试。实际 DOCX 转换统一由已绑定的 `3gpp-review` 提供，不维护第二套转换代码。

## 输入

取得用户指定的目录或准确文件列表。先列出文件格式和数量；不能仅凭文件名猜路径。用户没有要求递归时不扩大到子目录。不要沿用旧的 `standards/`、`raw/` 或 `/ingest` 约定，也不把格式转换作为提案分析之后的必选步骤。

- DOCX：使用下述批量命令，保留原图和嵌入对象。
- DOC：环境有 LibreOffice 时，可先在新任务目录转换成 DOCX，再按下述流程处理；保留原件和中间文件，说明旧格式转存可能影响排版和嵌入对象。
- PDF/PPTX：当前共享转换器不支持。保留文件并在批次结果中列为未转换，说明原因；不要把纯文本提取冒充完整转换，也不要将 PPTX 直接交给 Pandoc。

不在任务中自动安装依赖。格式不受支持不应阻止其余 DOCX 完成。

## 执行

规划前激活 `3gpp-review`，使用它返回的准确 `skillRoot` 作为 Bash 的 `cwd`。用文件工具在新任务目录写 `inputs.json`，内容为原件绝对路径的 JSON 数组，包括未支持的格式，以便汇总失败：

```json
["/workspace/uploads/a/proposal.docx", "/workspace/uploads/b/slides.pptx"]
```

```bash
python3 scripts/3gpp_tdocs.py convert-batch --inputs /workspace/<任务>/inputs.json --output /workspace/<任务>/converted
```

输出目录必须不存在。每个输入文件使用独立编号目录，避免同名文件冲突。脚本每处理一个文件就保存 `batch-summary.json`，失败不会覆盖已成功结果。非零退出码表示存在失败项，读取汇总后如实报告。

重试时从汇总中提取失败文件，在新输出目录只重试这些文件；不要覆盖原批次。如果只有一个 DOCX，可调用 `3gpp.convert-markdown` 一次，成功后不重复转换。

## 检查与交付

检查每个成功项的 Markdown、图片/嵌入对象清单、conversion-summary.json 和 ZIP；检查批次中输入数等于成功数加失败数。说明各 ZIP 路径、转换警告和未转换文件。复用 review 的转换检查规则，不运行提案分析 coverage，也不自动调用知识库发布工具。

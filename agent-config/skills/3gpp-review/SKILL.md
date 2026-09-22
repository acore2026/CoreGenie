---
archived: false
name: 3gpp-review
description: 读取、提取和分析 3GPP TDoc；按会议和 KI 获取官方提案统一使用 3gpp.download。简短会议事实用 3gpp-lookup；跨会议路线分析用 3gpp-position-evolution；批量转换用 3gpp-doc2md。
allowed-tools: skill.read_resource 3gpp.resolve-meeting 3gpp.download 3gpp.convert-markdown bash python filesystem.read filesystem.write filesystem.list filesystem.search web.fetch knowledge.search knowledge.ingest user.ask vision.inspect knowledge.publish
---

# 3GPP 提案资料与分析

本包提供官方提案的资料准备、DOCX 转换和通用立场判断。先按任务选择模式，只读取需要的参考文件。激活 Skill 在规划前完成，不单独创建“加载 Skill”任务。

## 模式

- **Conversion mode**：单个已存在 DOCX 转 Markdown、图片及嵌入对象。读取 [references/conversion.md](references/conversion.md)，优先调用 `3gpp.convert-markdown` 一次；不分析观点、不运行研究 coverage、不自动入库。
- **批量转换**：读取 conversion 参考，使用本脚本的 `convert-batch --inputs <路径数组JSON> --output <新目录>`。批次选择与重试由 `3gpp-doc2md` 说明。
- **资料准备**：为矩阵、技术路线或用户要求的文档清单服务。按会议和 KI 获取资料时调用 `3gpp.download`；读取 [references/research-workflow.md](references/research-workflow.md) 中所需的提取、检查和 coverage 步骤；已提供资料时跳过重复获取，不生成或发布中间报告。
- **提案分析**：读取 research-workflow；涉及公司主张时再读 [references/stance-evidence.md](references/stance-evidence.md)。分析每篇提案并关联原文，按用户要求交付报告。
- **已有本地提案**：直接提取用户给出的文件，不为补齐官方 Index 扩大任务。无法验证会议元数据时明确说明；没有官方 manifest 不伪造 coverage 或声称官方资料覆盖完整。
- **汇报 PPT 的资料准备**：由 `3gpp-proposal-ppt` 负责卡片、排版和交付；本包只提取原文及 `*.source.json`。该索引记录正文块、原图和图片所在位置（含表格内图片），不生成另一份中间分析报告。

## 通用约束

- 官方目录、KI 议程映射、版本和状态必须查看实际资料。按会议和 KI 下载只能调用 `3gpp.download`；不猜 URL，也不直接运行下载命令。
- 包内脚本为 [scripts/3gpp_tdocs.py](scripts/3gpp_tdocs.py)，由下载和转换 Tool 调用。Bash 的 `cwd` 必须使用激活返回的准确 `skillRoot`；不要把 `skill://` 当 shell 文件路径，不复制脚本到工作区。
- 每次 Bash 调用启动新 shell，在同一次命令中定义所需路径，或直接使用已确认的绝对路径。
- 中间文件保存在当前任务的新目录。缓存以来源和选择范围为准，不在同一 texts 目录混入其他批次。复用工具返回的准确路径，不重建猜测路径。
- 工具失败时保留原件、已完成结果和具体错误。缺失资料可以交付明确标注的部分分析，但不能声称已通过完整覆盖检查。
- 提取文本保留 `[INS:...]` 和 `[DEL:...]`；它们表示增删动作，不自动等于支持或反对。实质结论引用原文位置。模糊图直接说明，不补画、不推测箭头。
- coverage 验证 TDoc 集合、非空正文和本次文本哈希，不能证明语义正确或逐篇分析完成。发布前仍要检查报告、引用和重要图表。
- Workspace 知识库即 RAG：`knowledge.search` 检索，`knowledge.ingest` 入库普通文件，`knowledge.publish` 发布最终报告。个人记忆工具不用于保存提案正文。
- 报告发布遵循当前任务和 Agent 的约定。资料准备、转换和连续执行实验模式不发布中间报告。发布时传完整 manifest 和 coverage receipt，每次运行只发布一份最终报告；入库失败仍交付已保存的报告及具体原因。

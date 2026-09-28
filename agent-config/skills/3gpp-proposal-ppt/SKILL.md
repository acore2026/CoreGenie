---
name: 3gpp-proposal-ppt
description: 根据单份或一批 3GPP DOCX 提案制作中文汇报 PPTX，使用原文图表、提案对比和逐页复检。用于提案胶片、会议汇报、目录批量生成 PPT；不用于 PPTX 转 Markdown。
allowed-tools: skill.read_resource bash python filesystem.read filesystem.write filesystem.list filesystem.search vision.inspect user.ask
---

# 3GPP 提案汇报 PPT

将提案整理成带原文出处、可编辑表格和原图的宽屏 PPTX。适用于单篇和批量；不重新维护下载、DOCX 解析或公司立场规则。

## 执行方式

1. 规划前加载本 Skill 和 `3gpp-review`。直接使用用户给出的资料；需要下载时使用 review 的资料准备模式，不发布中间报告。若当前 Agent 未绑定依赖或没有视觉工具，明确说明缺少的能力。
2. 使用 review 包内 `scripts/3gpp_tdocs.py extract --input <DOCX文件或目录> --texts <任务正文目录> --figures <任务图片目录>` 提取正文、表格、图片和 `*.source.json`。每次新建任务目录，记录用户选择的全部输入及提取失败项；不要靠成功清单倒推用户范围。
3. 阅读 [references/cards.md](references/cards.md)，生成统一分析卡片。卡片里的结论、数字、表格必须关联原文位置；涉及公司立场再读取 review 的 `references/stance-evidence.md`。分别记录提案主张和会议结论。只看得见原文摘要时，不声称已分析全文。
4. 查看要用的原图，记录出处和可读性。WMF/EMF 可尝试包内 `render_qa.py preview`；VSD/VSDX 复用 review 的转换流程。保留原件。无法辨认时只说明限制，可引用正文明确说明的事实，不推测箭头或补画流程图。
5. 调用 `scripts/proposal_ppt.py --input <卡片JSON> --output <新目录>`；可先用 `--validate-only` 检查。脚本直接读取卡片，生成 PPTX、卡片副本和构建记录，不要求 Agent 临时编写生成代码。`--font` 和 `--accent` 可调整字体与强调色。
6. 按 [references/quality-check.md](references/quality-check.md) 渲染并逐页检查图表、文字和数字。生成与渲染成功不等于复检通过。缺少渲染环境或视觉能力时交付明确标注“未完成排版检查”的草稿，不填写通过记录。
7. 交付 PPTX 下载文件，说明已分析和未完成的资料，以及未检查项。默认不入库、不写回源目录、不覆盖上次文件；使用系统实际返回的附件或下载机制，不编造 file 块或 URL。

## 运行约束

- Bash 的 `cwd` 使用激活返回的准确 `skillRoot`，脚本路径相对该包根目录。读取另一个 Skill 的资源不等于它在同一次沙箱调用中已挂载；分别在对应包的调用中执行，结果保存在同一任务工作区。
- 沙箱依赖由项目镜像提供：Python、python-pptx、Pillow；渲染另需 LibreOffice Impress/Draw、pdftoppm 和中文字体。缺少依赖先说明需更新沙箱，不自行更改生产安装。
- 默认白底、红色标题、原图保持比例、表格可编辑。优先可读，不强行每提案压成 1–2 页；长内容分页，不能缩小到看不清或静默删字。当前脚本不接受任意 PPT 模板；指定模板不兼容时先说明，不假装套用。
- 可用运行时分工处理独立提案，结果统一为卡片；并发服从运行时限制，不硬编码“超过五篇必须分工”。汇总者遇到矛盾应回原文查看，不能仅凭卡片自行消解。
- 引用与文件哈希检查不能证明语义正确。数字检查要确认单位、样本范围、条件和原文表格；`verified` 是分析者判断，不是出现同一个数字就算核对通过。

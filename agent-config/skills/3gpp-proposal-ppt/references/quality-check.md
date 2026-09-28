# 构建、渲染和复检

每次使用新输出目录。执行前分别确认两个 Skill 的准确 skillRoot；下列命令在 PPT Skill 根目录运行。

```bash
python3 scripts/proposal_ppt.py --input /workspace/task/cards.json --validate-only
python3 scripts/proposal_ppt.py --input /workspace/task/cards.json --output /workspace/task/deck-v1
python3 scripts/render_qa.py render --input /workspace/task/deck-v1/proposals.pptx --output /workspace/task/render-v1
```

WMF/EMF 预览：

```bash
python3 scripts/render_qa.py preview --input /workspace/task/figures/image1.wmf --output /workspace/task/preview-1
```

脚本保留原件，用隔离的 LibreOffice 用户配置生成预览。无输出、转换错误或依赖缺失都会记录到 `render-summary.json` 并返回非零退出码。WMF/EMF 不保证均可转换，成功也必须目检；VSD/VSDX 使用 review 的转换器，不把第一页预览当成完整多页对象。

## 三种不同的检查

1. **卡片和构建检查**：源文件哈希、引用位置、图片映射、表格列数、有限坐标、页边界、正文区域及元素相交；文字行数只是保守估计。不会判断分析结论，也不能替代真实排版。
2. **渲染检查**：检查导出图片数量与 PPT 页数一致、图片可解码，记录每张图片和 PPT 的哈希。成功状态是 `rendered`，不是复检通过。
3. **逐页复检**：使用 `vision.inspect` 查看每张渲染图片，检查文字出框、孤行标点、覆盖、图中文字、留白，以及引用的原文数字和单位；检查中文是否自然、提案主张是否被误写成会议结论。引用全文保存在 PPT 页面备注，不展示本地调试路径。

有问题先改卡片，再生成新版本并重新渲染；不可改完文字后沿用旧检查结果。默认最多修复两轮；仍有问题时保留草稿和具体问题，向用户说明，不无限重试。如果任务明确要求最终排版通过而环境不支持，则交付部分结果并说明未完成原因。

可由独立复检 Agent 完成逐页检查，但其可用性、授权和并发以当前运行时为准。没有分工工具时由当前 Agent 检查，不虚构第二位复检者。

完成实际检查后，写入复检 JSON。示例中的哈希必须替换为本次文件的实际值：

```json
{
  "deckSha256": "本次PPT哈希",
  "reviewer": "实际复检者或Agent名称",
  "slides": [{
    "number": 1,
    "imageSha256": "该页渲染图片哈希",
    "checks": {"layout": "passed", "figures": "not_applicable", "numbers": "not_applicable", "wording": "passed"},
    "findings": []
  }]
}
```

每页必须有一条记录。没有图或数字的页面才可将对应项标为 `not_applicable`；未检查不能填成不适用。存在问题时保留 `findings` 和未通过项，不申请通过记录。

```bash
python3 scripts/render_qa.py verify-review --render-summary /workspace/task/render-v1/render-summary.json --review /workspace/task/review-v1.json --output /workspace/task/review-receipt-v1.json
```

脚本检查所有页面记录及文件版本，生成单独的 `reviewed` 记录；原构建记录保留 `draft` 表示其生成时状态。PPT 或任一渲染图变化后旧复检不再适用。这个记录只绑定复检者的判断，不能证明对方确实看过图片或结论正确。

## 依赖和兼容性

项目沙箱固定安装 `python-pptx==1.0.2`、Pillow、LibreOffice Impress/Draw、poppler-utils 和 Noto CJK 字体。更新代码后需重建沙箱镜像才能获得新依赖；不要求 Windows 或 PowerPoint COM。最终使用 PowerPoint 时可能出现字体或换行差异，重要对外汇报仍建议在目标软件抽查。

生成实现参考 [python-pptx 图片和表格接口](https://python-pptx.readthedocs.io/en/latest/api/shapes.html)；同时指定图片宽高会拉伸，因此脚本先读取真实像素比例，再计算包含于页面区域的尺寸。

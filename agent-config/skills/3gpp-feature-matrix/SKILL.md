---
archived: false
name: 3gpp-feature-matrix
description: 根据 3GPP 提案原文和分析记录生成特性与公司立场矩阵，区分明确支持、反对、保留意见、替代方案和资料不足。用于同一会议的公司对比；跨会议变化另用 3gpp-position-evolution。
allowed-tools: skill.read_resource bash python filesystem.read filesystem.write filesystem.list filesystem.search web.fetch 3gpp.resolve-meeting knowledge.search knowledge.publish user.ask vision.inspect
---

# 特性与公司立场矩阵

根据用户指定的会议、KI/主题和提案范围生成中文矩阵。维度和公司列表从本次资料中确定，不预设公司阵营，不强凑维度数量。

## 资料与依赖

本 Skill 依赖已绑定的 `3gpp-review`。在规划前激活两者，通过 `read_skill_resource` 读取 review 包的 `references/stance-evidence.md`，按其中的统一分类规则判断立场。已有来源和分析记录时直接使用；不要为读取分类规则额外生成提案总结。

1. 使用用户提供的准确路径；否则搜索工作区和知识库定位分析记录和原始提案。按会议/KI 下载的资料在工具返回的 proposal 目录，分析在相邻 analysis 目录，不硬编码旧报告路径。
2. 总结仅用于定位问题和原文，不是立场判断的唯一依据。没有原文或明确引用时标注资料不足，不从摘要补造引用。
3. 缺少提案时按 review 的资料准备流程查找、下载和提取，保存实际路径。此时只准备矩阵所需资料，不另写或发布一份中间报告。
4. 缺少 review 绑定时使用已提供的原文，并说明未完成资料准备；不要假装调用未提供的 Skill 或把斜杠命令当工具。

## 分析

先写 `stance-records.json`，再由同一份记录生成所有表格。读取 [references/matrix-contract.md](references/matrix-contract.md) 获取字段与展示规则。

- 按技术问题选择有原文支撑的维度，允许只有少数维度；选项能否共存需要资料支持。
- 一条记录对应公司、TDoc、技术维度和具体选项。保留明确的来源位置、短引用或准确转述。
- 提取文本中的 `[INS:...]`、`[DEL:...]` 用于识别修订。新增不自动代表支持，删除不自动代表反对；结合提案目的、周围段落和版本说明判断。
- 没有修订标记时检查原 DOCX。新提案可能没有修订记录：可依据明确的提案主张判断，不把沿用背景当作本次主张。
- 联合署名只支持有明确依据的具体主张；支持一个选项不自动反对另一个选项。
- 没有相关证据使用“资料不足”；只有已检查的材料确实不涉及某维度才使用“未涉及”。
- 同公司存在不同主张时保留 TDoc、版本和条件，标明混合立场，不用多数票覆盖冲突。
- 大量提案可按文件分批；运行时允许并行时，各批使用同一维度定义和记录格式，最后统一汇总。

## 结果与检查

单会议/KI 的最终矩阵保存在工具返回目录的 `analysis/`；跨范围汇总使用 `/workspace/3gpp/comparisons/<新任务>/analysis/`。立场记录等中间文件保存在 `_meta/tasks/<新任务>/`，不混入交付目录。报告包含范围、资料覆盖、维度说明、公司矩阵、主要分歧和参考资料；按资料规模决定是否增加阵营分析。阵营只是本次问题上的分组，不代表长期联盟或会议共识。

调用包内 [scripts/build_matrix.py](scripts/build_matrix.py) 检查记录并生成基础矩阵，Bash cwd 使用本 Skill 的激活根目录：

```bash
python3 scripts/build_matrix.py \
  --input '/workspace/_meta/tasks/<run-id>/stance-records.json' \
  --output '/workspace/3gpp/comparisons/<run-id>/analysis/matrix.md'
```

输出文件必须不存在。脚本不推导其他选项的反对立场，并将没有记录的单元格显示为资料不足。需要“未涉及”标记或进一步分歧说明时，在检查完整原文后补充说明及检查范围，不修改有依据的矩阵状态。脚本只检查字段、归属和分类约束，不证明引用真实或语义判断正确。

检查每个明确立场都关联原文；逐一核对记录与矩阵是否一致、公司是否遗漏、缺失资料是否披露。表格使用中文状态，并在单元格或紧邻说明中关联证据编号。跨会议对比要分别列会议、快照和来源，不能把不同会议的记录合并为同一当前立场。

交付报告和记录路径、提案覆盖及限制。只有用户要求保存到知识库时才发布最终报告；没有发布要求时交付工作区文件即可。发布需遵守 review 的 manifest/coverage 要求，工具不可用时说明已保存文件但未入库。

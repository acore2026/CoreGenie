---
archived: false
name: 3gpp-feature-matrix
description: Generate a Feature-Company Convergence Matrix from 3GPP TDoc summaries. Reads proposal summaries (from 3gpp-review output), extracts key technical feature dimensions, maps each company's stance, and produces a structured matrix document with camp analysis. Triggers on phrases like "feature matrix", "特性矩阵", "收敛矩阵", "公司阵营", "company camp analysis", "generate feature matrix".
---

# 3GPP Feature-Company Convergence Matrix Generator

从 3GPP 提案总结文档中自动提炼关键技术特性维度，映射各公司立场，生成特性-公司收敛矩阵文档。

**IMPORTANT**: Follow each step EXACTLY as written. Do NOT skip steps.

---

## WORKFLOW OVERVIEW (5 steps, execute in order)

```
Step 1: Parse input & locate summary document
Step 2: Read summary & extract proposal/company/feature data
Step 3: Identify key feature dimensions & map company stances
Step 4: Generate Feature Matrix document
Step 5: Verify & report
```

---

## STEP 1: Parse Input & Locate Summary Document

### 1.1 Parse user input

The user provides a meeting identifier and KI number. Parse them:

| User says | WG | Meeting | KI |
|-----------|-----|---------|-----|
| `SA2#176 KI#22` | SA2 | 176 | 22 |
| `SA2#175-AH-e KI#19` | SA2 | 175-AH-e | 19 |
| `174 KI22` | SA2 (default) | 174 | 22 |

Record: `$wg`, `$meetingNum`, `$kiNum`

### 1.2 Locate summary document

The summary document should be at:
```
standards/KI{kiNum}_TDocs_{meetingNum}/{meetingNum}_KI{kiNum}.md
```

For example: `standards/KI22_TDocs_176/176_KI22.md`

**Check if the summary exists:**

```powershell
$summaryPath = "standards/KI${kiNum}_TDocs_${meetingNum}/${meetingNum}_KI${kiNum}.md"
if (Test-Path $summaryPath) {
    Write-Output "Summary found: $summaryPath"
} else {
    Write-Output "Summary NOT found. Need to run 3gpp-review first."
}
```

### 1.3 Auto-trigger 3gpp-review if needed

If the summary document does NOT exist, **automatically invoke the `3gpp-review` skill** first:

```
User wants: /3gpp-feature-matrix SA2#176 KI#22
→ Summary not found at standards/KI22_TDocs_176/176_KI22.md
→ Auto-trigger: /3gpp-review SA2#176 KI#22
→ Wait for completion → then continue to Step 2
```

Tell the user: "未找到总结文档，将先运行 3gpp-review 生成提案总结，完成后继续生成特性矩阵。"

---

## STEP 2: Read Summary & Extract Data

### 2.1 Read the full summary document

Read the entire `{meetingNum}_KI{kiNum}.md` file. This file contains:
- Section 一: Overview (meeting info, total proposals, company list)
- Section 二: Solution classification tables (proposal → company → topic)
- Section 三: Company comparison table
- Section 四: Individual proposal summaries (the KEY data source)
- Section 五: Consensus and divergence analysis

### 2.2 Extract key data

From the summary, extract the following structured data:

**A) Metadata:**
- Meeting name, location, date
- KI number and title
- Total proposal count
- List of all participating companies

**B) Per-proposal data (from Section 四):**
For each proposal, extract:
- Document number (e.g., S2-2606870)
- Source company (e.g., China Mobile)
- Solution/Variant target (e.g., Sol#22.2 Variant A)
- 主题概述 (one-line topic summary)
- 修订要点 (what's new/changed in this revision — from Track Changes `[INS:...]` markers)
- 技术总结 (2-8 sentences, at least 100 chars)
- 阵营判断 (company's stance: which Solution/Variant they support, core position)
- Key new NFs/functions introduced
- Key procedures/call flows
- Any figures/tables

**C) Cross-proposal patterns:**
- Which companies propose similar architectures?
- What are the competing design choices?
- Where do companies agree vs disagree?

### 2.3 Also check for raw proposals

If raw proposal files exist in the standards folder:
```
standards/KI{kiNum}_TDocs_{meetingNum}/
```

Read individual proposal files (if they are .md format) for additional detail. The summary's Section 四 is the primary source, but raw proposals provide deeper context for stance extraction.

---

## STEP 3: Identify Feature Dimensions & Map Stances

This is the **core analytical step**. You must:

### 3.1 Identify 8-12 key feature dimensions

From the proposal data, identify the **key mutually-exclusive architectural/technical choices** that define company positions. These should be:

- **Architecturally significant**: The choice fundamentally affects the system design
- **Mutually exclusive or multi-option**: Companies take different stances
- **Proposal-supported**: At least 2-3 proposals address each dimension

**How to identify dimensions:**

1. Look for **Solution Variants** — each Variant represents a different architectural choice
2. Look for **competing mechanisms** — e.g., different ways to achieve the same goal (node selection, authorization, continuity)
3. Look for **standardization debates** — what to standardize vs leave as implementation
4. Look for **consensus/divergence** in Section 五 of the summary

**Example dimensions (from KI#22):**

| # | Feature | Options |
|---|---------|---------|
| 1 | 协调架构 | CMF+CN / CCCE+SHE / AF-CCAF / 双模式 |
| 2 | 请求路径 | SM NAS / Computing NAS / AF应用层 |
| 3 | 质量标识 | CQID / CCI / CQI / 不标准化 |
| ... | ... | ... |

### 3.2 Map each company's stance on each dimension

For each company, determine their position on each feature dimension:

- **支持** = 本次修订的 [INS:] 部分明确支持或提出了该方案/选项（cite the proposal number and quote the relevant [INS:] text）
- **不确定** = 本次修订的增删内容中看不出该公司在该特性上的明确立场（如修订为编辑性修改、移除 EN 等，无法判断支持哪个选项）
- **反对** = 本次修订的 [DEL:] 部分删除了与该特性相关的实质性内容（表明该公司反对被删除的论点），或 [INS:] 部分明确提出了与被删内容相反的方案

**判断原则：只基于修订内容（[INS:] 和 [DEL:] 标记部分）判断立场**。绝对不要根据提案的非增删内容（即未标记的正文）推断立场——那些内容可能是沿用的既有文本，不一定是该公司本次的主张。

**DEL 内容的区分处理：**
1. **编辑性删除**（如移除冗余措辞、格式清理、移除已过时的 EN/FFS）→ 忽略，不影响立场判断
2. **实质性删除**（删除了某项技术方案、某个机制描述、某个架构选项）→ 表明该公司**反对**被删除的内容，可标记为"反对"
3. **替换式删除**（DEL 旧内容 + INS 新内容，属于修改）→ 综合 INS 和 DEL 判断：新增的内容表明新立场，被删除的内容表明不再支持的旧立场

**How to determine stance (revision-only, INS + DEL):**

1. **Primary stance from INS**: Based ONLY on the [INS:] content — what specific mechanism/option did the revision add?
2. **Stance from DEL**: Based on the [DEL:] content — did the revision delete substantive technical content? If yes, the company is opposing the deleted approach.
3. **Editorial DEL check**: If the [DEL:] content is clearly editorial (formatting, removing obsolete EN like "FFS", terminology cleanup), do NOT count it as opposition — treat as "不确定".
4. **Camp judgment**: Use the 阵营判断 field from each proposal summary. If it says "本次修订为编辑性修改，阵营判断不明确", mark as "不确定".
5. **No stance from non-revision text**: NEVER infer stance from unmarked text in the proposal. Unmarked text is existing/context text that the company may not be endorsing.
6. **Secondary stance**: Based on joint proposals — which company's proposal did they co-sign?

**Critical rule**: Every "支持" or "反对" stance must be backed by a specific proposal reference AND a quote from the [INS:] or [DEL:] content. Use the format:
```
支持: 公司名【S2-XXXXXXX】INS 原文："…新增的关键表述…"
反对: 公司名【S2-XXXXXXX】DEL 原文："…删除的关键表述…"（表明反对该方案）
不确定: 公司名【S2-XXXXXXX】本次修订的增删内容无法判断对该特性的立场
```

**Note for Section 五**: Section 五 的打勾矩阵**不需要**判断理由和原文引用，仅填 ✅/🔄/— 符号。详细的判断理由已在 Section 四中提供。

### 3.3 Data sources

The skill relies on two key data sources in the `standards/` folder:

1. **Summary document** (`{meeting}_KI{ki}.md`): Contains per-proposal summaries with technical descriptions, solution classifications, and consensus analysis. This is the primary source for identifying feature dimensions and company positions.

2. **Text files with revision markers** (`texts/S2-XXXXXXX.txt`): Contains the full text of each proposal with `[INS:text]` markers (inserted content) and `[DEL:text]` markers (deleted content) indicating tracked changes. Both marker types are the **ground truth** for stance determination — [INS:] content represents what the company is actively proposing, while [DEL:] content may represent what the company is opposing or removing.

If the `texts/` directory doesn't exist or files don't have `[INS:]` markers, the skill should still work using the summary document alone, but stance judgments will be less precise.

### 3.4 Identify company camps

Based on the **most significant architectural dimension** (usually the coordination architecture), group companies into camps:

- **Majority camp**: Companies sharing the dominant architecture
- **Alternative camps**: Companies with distinctly different architectures
- **Hybrid/flexible camps**: Companies supporting multiple approaches
- **Unique proposals**: Companies with novel individual approaches

### 3.5 Use parallel agents for large datasets

If there are more than 40 proposals, use **parallel agents** to:
- Batch 1: Analyze proposals 1-25, extract feature stances
- Batch 2: Analyze proposals 26-50, extract feature stances
- Batch 3: Analyze proposals 51+, extract feature stances

Each agent prompt should include:
```
你正在分析 3GPP SA2#{meeting} KI#{ki} 的提案。
请读取以下提案的总结，提取每个提案在以下特性维度上的立场：
[列出已识别的特性维度]

对每个提案输出：
- 文档编号
- 来源公司
- 各维度的立场（支持/不确定/反对）
  - 支持 = 本次修订 [INS:] 内容中明确支持或提出了该方案（引用提案号和 [INS:] 原文）
  - 不确定 = 本次修订的增删内容看不出该公司在该特性上的明确立场
  - 反对 = 本次修订 [DEL:] 内容中删除了与该特性相关的实质性内容（引用提案号和 [DEL:] 原文）
- 立场判断理由（引用修订要点中的关键表述）

重要：
1. 只根据提案的修订内容（[INS:] 和 [DEL:] 标记部分）判断立场
2. 如果修订只是编辑性修改（移除 EN、术语澄清等），则标记为"不确定"
3. 绝对不要从提案的非增删正文内容推断立场
```

---

## STEP 4: Generate Feature Matrix Document

### 4.1 Output file location

```
standards/KI{kiNum}_TDocs_{meetingNum}/{meetingNum}_KI{kiNum}_Feature_Matrix.md
```

### 4.2 Document structure (MANDATORY)

The document MUST follow this exact 5-section structure:

```markdown
# {WG}#{meeting} KI#{ki} 特性-公司收敛矩阵

## 文档说明

[概述文档目的、数据来源、特性维度列表、阵营概览、文档结构说明]

### 数据来源
- 会议: ...
- 议题: ...
- 提案数: ...
- 参与方: ...

### 十大特性维度
[表格：# / 特性维度 / 核心分歧]

### 四大阵营
[表格：阵营 / 代表公司 / 核心主张]

### 文档结构
[表格：章节 / 内容 / 阅读场景]

---

## 一、总表速读指南

[对最核心的 2-3 个特性维度，用代码块展示阵营划分]

---

## 二、公司阵营分析

> 阵营划分**只基于各公司本次会议修订内容（[INS:] 和 [DEL:] 部分）中体现的立场**。[INS:] 表明公司在推动什么方向，[DEL:] 可能表明公司在反对或移除什么方向（需区分编辑性删除和实质性删除）。如果某公司的修订内容无法判断其阵营归属，归入"不确定"类。

### 2.1 阵营全景
[ASCII 树状图展示阵营结构，包含"不确定"分类]

### 2.2 [阵营A名称]（N 家）
[核心主张 + 公司详细表格（公司/提案数/核心贡献/独特视角）+ 阵营内部共性 + 阵营内部分歧]
> 每家公司的阵营归属必须有 Section 四/五 中的修订内容作为支撑

### 2.3 [阵营B名称]（N 家）
[同上]

### 2.N 不确定（N 家）
[本次会议修订内容无法判断阵营归属的公司。列出公司名、修订内容摘要、以及为什么无法判断。]

| 公司 | 修订内容摘要 | 无法判断原因 |
|------|------------|------------|
| 公司X | 移除 EN / 术语澄清 | 修订为编辑性修改，无实质性技术立场 |

### 2.N+1 跨特性关联分析
[表格：各阵营在非核心特性上的典型关联选择]

### 2.N+2 关键 battleground
[最争议的 2-3 个问题及其双方论证]

---

## 三、各公司特性选择一览

[总表：公司 × 8个核心维度，每格填写该公司的核心选择]

---

## 四、特性-公司总表（特性视角）

> 以一级特性为主线，每个特性一个子章节。子章节内先列总表，再逐条列出判断理由。
> **关键规则：表格中列出的每一家公司，都必须在表格下方的判断理由中有对应的一行。**

### 4.1 [一级特性1名称]

| 二级特性（选项） | 支持的公司 |
|-----------------|----------|
| [选项A] | 公司A，公司B，公司C |
| [选项B] | 公司D |
| [选项C] | 公司E，公司F |

**判断理由：**
- **公司A**【S2-XXXXXXX】原文："…修订中新增的关键表述，表明支持选项A…"
- **公司B**【S2-XXXXXXX】原文："…修订中新增的关键表述…"
- **公司C**【S2-XXXXXXX】与 XX 联合提案 — 支持选项A
- **公司D**【S2-XXXXXXX】原文："…修订中新增的关键表述，表明支持选项B…"
- **公司E**【S2-XXXXXXX】原文："…"
- **公司F**【S2-XXXXXXX】不确定：本次修订为编辑性修改

> **⚠️ 必须覆盖所有公司**：如果选项A列出了3家公司，选项B列出了1家，选项C列出了2家，则判断理由必须恰好有 3+1+2=6 行，每行对应一家公司。不允许遗漏。

### 4.2 [一级特性2名称]

（同上格式，每个一级特性重复）

---

## 五、各特性详细对照表

> ✅ = 支持，🔄 = 不确定，🚫 = 反对，— = 不涉及
> 立场判断**只基于修订内容**（[INS:] 和 [DEL:] 标记部分）。[INS:] 表明支持，[DEL:] 删除实质性内容表明反对，编辑性删除不影响立场。无法从增删内容判断则标为"不确定"。
> 纵向为特性选项，横向为公司全称。每个特性一个子章节。

### 5.1 [特性1名称]

| 选项 | China Mobile | Huawei | OPPO | vivo | Xiaomi | CATT | NEC | Samsung | ETRI | NTT DOCOMO | DT | AT&T | Nokia | Ericsson | LGE | Lenovo | China Telecom | Apple | ZTE | IIT Bombay | Jio | LG Uplus | TOYOTA | InterDigital | TNO | Philips | MediaTek | T-Mobile |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| [选项A] | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| [选项B] | — | — | ✅ | ✅ | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | ✅ | — | — | — | — | — | — |
| [选项C] | — | — | — | — | — | — | — | — | — | — | — | — | ✅ | ✅ | ✅ | — | — | ✅ | — | — | — | — | — | — | — | — | — | — |

### 5.2 [特性2名称]
...

### 5.N [特性N名称]
...

---

*文档生成时间: YYYY-MM-DD*
*数据来源: 3GPP {WG}#{meeting} ({Location}, {Date}) KI#{ki} 全部 {N} 篇提案*
```

### 4.3 Section 五 格式规范（详细）

Section 五使用 **✅/🔄/🚫/— 四符号打勾矩阵**格式，与 Section 四（带判断理由的列表格式）形成互补：

**符号含义（4种，不可混淆）：**

| 符号 | 含义 | 判定标准 |
|------|------|---------|
| ✅ | 支持 | 修订内容中明确支持或提出了该选项（有 [INS:] 证据） |
| 🔄 | 不确定 | 修订为编辑性修改，无法判断立场；或虽涉及该维度但立场模糊 |
| 🚫 | **反对** | 该公司**明确支持另一个互斥选项**，因此对该选项构成反对 |
| — | **不涉及** | 该公司的修订内容**完全不涉及**该特性维度 |

**🚫 与 — 的区分规则（关键）：**

1. **🚫 反对**：当某公司在同一维度中**明确 ✅ 支持另一个互斥选项**时，对该维度下的其他互斥选项标 🚫
   - 例如：某公司在"协调架构"维度 ✅ 支持 "CMF+CN"，则对 "CCCE+SHE" 和 "AF/CCAF" 标 🚫
   - 例如：某公司 ✅ 支持 "Computing NAS"，则对 "SM NAS" 和 "AF应用层" 标 🚫

2. **— 不涉及**：当该公司的修订内容**完全不涉及该特性维度**时，标 —
   - 例如：某公司只关注"协调架构"，对"质量标识"、"CER参数"等维度完全没有修订 → 这些维度标 —
   - 🔄 不确定的公司不触发互斥规则（因为没有明确 ✅ 支持任何选项）

**互斥关系参考（按维度）：**

| 维度 | 互斥选项组 |
|------|-----------|
| 协调架构 | CMF+CN ↔ CCCE+SHE ↔ AF/CCAF（三者互斥） |
| 请求路径 | SM NAS ↔ Computing NAS ↔ AF应用层 ↔ URSP+CC Profile ↔ Agent（互斥） |
| 质量标识 | CQID ↔ CCI ↔ CQI ↔ 不标准化（标准化方案互斥） |
| CN选择 | CMF直接 ↔ CCCE+SHE ↔ AF/EEL（互斥）；CMF+SMF联合与CMF直接部分重叠 |
| 授权方式 | URSP ↔ CMF ↔ CCCE ↔ Agent ↔ AF/EEL（互斥） |
| Computing Layer | UPF透明 ↔ UPF感知 ↔ 不需要（互斥） |
| 连续性 | CMF迁移 ↔ CCCE重选 ↔ AF驱动（互斥）；CSCP/Per-CER可共存 |
| CN注册 | →CMF ↔ →eNRF ↔ 注册为AF ↔ SHE管理（互斥） |
| CER参数 | 各参数**不互斥**（公司可同时支持多个参数） |
| 请求发起方 | UE(SM NAS) ↔ UE(Computing NAS) ↔ AF发起 ↔ Agent发起（互斥） |

**表格结构：**
- **纵向（行）**：该特性维度下的各个选项（如 CMF+CN、CCCE+SHE、AF/CCAF 等）
- **横向（列）**：所有参与公司，使用**公司全称**（不用缩写）
- **单元格**：仅填 ✅、🔄、🚫 或 —，不附加文字

**公司列表（固定顺序，使用全称）：**

China Mobile, Huawei, OPPO, vivo, Xiaomi, CATT, NEC, Samsung, ETRI, NTT DOCOMO, DT, AT&T, Nokia, Ericsson, LGE, Lenovo, China Telecom, Apple, ZTE, IIT Bombay, Jio, LG Uplus, TOYOTA, InterDigital, TNO, Philips, MediaTek, T-Mobile

> **注意**：DT/AT&T 作为联合提案方分别列出（两列），因为它们经常联合署名但立场可能不同。所有 Section 五 的表格必须使用相同的公司列顺序。

**Section 五 vs Section 四 的关系：**
- Section 四：详细版 — 每个特性一个子章节，含2列表格（选项→支持的公司列表）+ **判断理由**（引用 [INS:] 原文），**必须覆盖表格中所有公司**
- Section 五：速览版 — 每个特性一个子章节，仅含 ✅/🔄/🚫/— 四符号打勾矩阵，**不含判断理由**
- 两者特性维度一一对应（5.1 对应 4.1，5.2 对应 4.2，以此类推）
- 读者可从 Section 五 快速定位分歧点（🚫 和 ✅ 的对立），再跳转到 Section 四 查看具体理由

### 4.4 Key formatting rules

1. **Section 一（速读指南）**: Use code blocks (```) for camp listings, not tables
2. **Section 二（阵营分析）**: Include ASCII art diagram + per-company detail tables
3. **Section 三（公司视角总表）**: Markdown table with company names as rows, features as columns
4. **Section 四（特性视角总表）**: **按一级特性拆分子章节**，每个子章节包含：
   - 一个2列表格，列为 `| 二级特性（选项） | 支持的公司 |`
   - 表格紧跟 **判断理由** 列表，格式为 `**公司名**【S2-XXXXXXX】原文："…修订中[INS:]新增的关键表述…"`
   - 如果某公司立场不确定，写 `**公司名**【S2-XXXXXXX】不确定：本次修订为编辑性修改`
   - **Company separator**: Chinese comma `，` (NOT `、` or `;`)
   - **CRITICAL-1**: 每个一级特性必须有独立的 `### 4.N` 子章节，不能合并为一张大表
   - **CRITICAL-2**: **表格中列出的每一家公司，都必须在判断理由中有对应的一行**。如果表格中某选项列出了 N 家公司，则判断理由中必须有 N 行分别对应这 N 家公司。不允许遗漏。
5. **Section 五（详细对照表）**: ✅/🔄/🚫/— **四符号**打勾矩阵格式（详见 4.3 节）
   - 纵向为选项，横向为公司全称
   - 每个单元格仅填 ✅/🔄/🚫/—，不附加文字
   - **🚫（反对）vs —（不涉及）**：明确支持互斥选项的标 🚫，完全不涉及该维度的标 —
   - 公司列顺序必须与 4.3 节定义的公司列表一致

### 4.5 Content generation strategy

Due to the large size of the document, generate it in parts using parallel agents:

**Part 1**: Document header + Section 一 (速读指南) + Section 二 (阵营分析)
- Write directly — these sections require analytical synthesis
- ~450 lines

**Part 2**: Section 三 (公司视角总表) + Section 四 (特性视角总表)
- These are structured tables built from the extracted data
- Section 四 is the largest section (~380 lines for 10 dimensions)
- Each sub-section needs: 2-column table + judgment reasons with [INS:] quotes

**Part 3**: Section 五 (详细对照表)
- ✅/🔄/— checkmark matrix, no judgment reasons needed
- ~135 lines for 10 dimensions
- Compact format: one table per dimension, companies as columns

> **Agent coordination**: Parts 1→2→3 must be sequential (each appends to the same file). Within each part, use parallel agents if needed for sub-sections.

### 4.6 Camp analysis content guidelines

For Section 二 (公司阵营分析), each camp sub-section should include:

1. **Core thesis** (1-2 sentences): What this camp believes
2. **Company detail table**:
   - Company name
   - Number of proposals
   - Core contribution (cite specific proposal numbers)
   - Unique perspective
3. **Internal commonalities**: What >80% of camp members agree on
4. **Internal divergences**: Where camp members disagree
5. **Visual diagram** (for the primary camp): ASCII art showing architecture

---

## STEP 5: Verify & Report

### 5.1 Verify completeness

Check that:
- [ ] All companies from the summary are represented
- [ ] All feature dimensions have company mappings
- [ ] Section 四 has proposal references for every company entry
- [ ] Section 五 has complete 支持/不确定/反对 matrices
- [ ] No company appears in contradictory camps without explanation

### 5.2 Verify consistency

Check that:
- [ ] Company camp membership in Section 二 matches Section 三 and 四
- [ ] Feature dimension names are consistent across all sections
- [ ] Proposal numbers cited are valid (exist in the summary)

### 5.3 Report to user

Output a summary:
```
✅ 特性-公司收敛矩阵已生成
📁 文件: standards/KI{ki}_TDocs_{meeting}/{meeting}_KI{ki}_Feature_Matrix.md
📊 统计:
  - 特性维度: {N} 个
  - 参与公司: {N} 家
  - 阵营数: {N} 个
  - 文档大小: {N} KB, {N} 行
```

---

## KEY FACTS CHEAT SHEET

```
Skill trigger:        /3gpp-feature-matrix {meeting} KI#{ki}
Dependency:           3gpp-review skill (auto-triggered if summary missing)
Input:                standards/KI{ki}_TDocs_{meeting}/{meeting}_KI{ki}.md
Output:               standards/KI{ki}_TDocs_{meeting}/{meeting}_KI{ki}_Feature_Matrix.md
Document sections:    5 (速读指南 / 阵营分析 / 公司总表 / 特性总表 / 详细对照表)
Feature dimensions:   8-12 (auto-identified from proposals)

立场判定（基于[INS:]修订内容）:
  支持 = 修订中明确支持或提出了该方案（有 [INS:] 证据）
  不确定 = 修订为编辑性修改，无法判断立场
  反对 = 修订中明确反对或未涉及

Section 四 格式: 每个特性一个子章节，含2列表格 + 判断理由（引用[INS:]原文）
  ⚠️ 关键规则: 表格中列出的每家公司都必须有对应的判断理由行，不允许遗漏
Section 五 格式: ✅/🔄/🚫/— 四符号打勾矩阵（选项为行，公司全称为列）
  ✅ = 支持，🔄 = 不确定，🚫 = 反对（明确支持互斥选项），— = 不涉及
  互斥规则: 明确✅支持某选项时，对其他互斥选项标🚫；完全不涉及的维度标—

公司列顺序: China Mobile, Huawei, OPPO, vivo, Xiaomi, CATT, NEC, Samsung, ETRI, NTT DOCOMO, DT, AT&T, Nokia, Ericsson, LGE, Lenovo, China Telecom, Apple, ZTE, IIT Bombay, Jio, LG Uplus, TOYOTA, InterDigital, TNO, Philips, MediaTek, T-Mobile
Company separator: 中文逗号 `，`（Section 四）

Camp criteria:        Based on most significant architectural dimension
Parallel agents:      Use for >40 proposals (batch by 15-25 each)
Output language:      中文 (Chinese)
```

---

## EXAMPLE: Complete execution for SA2#176 KI#22

```
User: "/3gpp-feature-matrix SA2#176 KI#22"

Step 1: Parse → WG=SA2, meeting=176, KI=22
        Check → standards/KI22_TDocs_176/176_KI22.md exists ✅

Step 2: Read summary → 87 proposals, 29 companies
        Read texts/ → 87 .txt files with [INS:] revision markers
        Extract → per-proposal company, solution, [INS:] stances

Step 3: Identify 10 feature dimensions:
        1. 协调架构 (CMF+CN / CCCE+SHE / AF / 双模式 / CCF / COF)
        2. 请求路径 (SM NAS / Computing NAS / AF)
        3. 质量标识 (CQID / CCI / CQI / API Ref / 不标准化)
        4. CN选择 (CMF直接 / CMF+SMF联合 / CCCE+SHE / eNRF / SMF+EASDF / AF)
        5. 授权方式 (URSP / CMF / SMF / CCCE / Agent / AF)
        6. Computing Layer (UPF透明 / UPF感知 / 不需要)
        7. 连续性 (CMF迁移 / CSCP / CCCE重选 / Per-CER / COF / AF驱动)
        8. CN注册 (→CMF / →eNRF / 注册为AF / SHE管理)
        9. CER参数 (Priority / Pre-emption / CCI / API Ref / Resource Type)
        10. 请求发起方 (UE / AF / Agent代替 / Agent独立)

        Map stances → 29 companies × 10 dimensions (based ONLY on [INS:])
        Identify camps → CN集中控制(~14) / SHE桥接(4) / AF外置(4) / 双模式(3) / 特色(2) / 不确定

Step 4: Generate document in 3 parts (sequential):
        Part 1: 文档说明 + 一(速读指南) + 二(阵营分析) → ~450 lines
        Part 2: 三(公司总表) + 四(特性总表, 10子章节+判断理由) → ~420 lines
        Part 3: 五(详细对照表, 10子章节, ✅/🔄/—矩阵) → ~135 lines

Step 5: Verify → all companies mapped, all dimensions covered
        Report → ✅ 文件已生成，10 维度，29 公司，5 阵营
        Final: 1003 lines, 104 KB
```

---

## 常见问题与注意事项

### Q1: 立场判断的"不确定"和"反对"如何区分？
- **不确定（🔄）**：提案修订内容仅为编辑性修改（如 EN→NOTE 转换、术语澄清、措辞调整），从中无法判断公司在该特性上支持哪个选项
- **反对（—）**：提案修订内容中明确反对某个选项，或该提案完全不涉及该特性维度
- **关键区别**：如果提案有实质性技术变更但变更方向不明确指向任何选项 → 不确定；如果提案完全没有实质性技术变更 → 也是不确定；只有当提案明确反对某选项时才标"反对"

### Q2: 一个公司在同一维度可以支持多个选项吗？
可以。例如：
- Huawei 在"协调架构"维度支持 CMF+CN+Agent（一个复合选项）
- OPPO 在"授权方式"维度同时支持 URSP 和 CMF（两种并行方案）
- 在 Section 五 的打勾矩阵中，这些公司会在多个选项行都标 ✅

### Q3: 为什么需要 Section 四 和 Section 五 两种格式？
- **Section 四（带理由）**：适合深入分析，提供 [INS:] 原文引用作为判断依据
- **Section 五（打勾矩阵）**：适合快速对比，一眼看出各公司在各维度上的立场分布
- 两者互补：从 Section 五 发现分歧点 → 跳转到 Section 四 查看具体理由

### Q4: 公司缩写表是否需要包含所有参与公司？
是的。缩写表必须覆盖文档中出现的所有公司。如果某个 KI 的参与公司列表与示例不同，需要根据实际情况调整缩写表。建议：
- 常用公司（China Mobile, Huawei, OPPO 等）使用固定缩写
- 新出现的公司临时定义缩写（如 TOYOTA→TY, TNO→TN）
- 缩写表放在 Section 五 的说明中，方便查阅

### Q5: 如何处理联合提案（多公司联合署名）？
- 联合提案中所有署名公司都标记为"支持"该提案所代表的选项
- 在 Section 四 的判断理由中标注"联合提案"
- 在 Section 五 的矩阵中，所有署名公司对应行都标 ✅
- 如果联合提案方（如 DT/AT&T）分别列为独立列，则各自独立标记

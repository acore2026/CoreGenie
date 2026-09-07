---
archived: false
name: 3gpp-split-docx
description: 将 3GPP TR/TS 文档（.docx 格式）按指定标题层级（一级/二级/三级标题）拆分为多个独立的 docx 文档。支持 `/split <文件路径> <拆分级别>` 触发，也支持自然语言触发（如"按三级标题拆分这个 TR 文档"）。当用户提到"拆分文档"、"按章节拆分"、"split TR"时触发。
user-invocable: true
---

# 3GPP TR/TS 文档拆分技能

## 核心工作流：Split by Heading Level

将一份完整的 3GPP TR/TS 文档（如 `23801-01-080_clean.docx`）按指定标题层级拆分为多个独立的 `.docx` 文档，完整保留文字、图片、表格和格式。

**流水线总览：**
```
0. 解析输入参数 → 1. 读取 body XML 元素 → 2. 按目标级别构建章节（H4/H5归入H3）
→ 3. 确定输出单元 → 4. 格式部件迁移 + XML 深度拷贝 + 图片迁移 → 5. 质量验证 → 6. 报告
```

**文件存储约定：**

支持两种输入方式：

**方式一：对话框直接上传 .docx 文件**
- 用户上传文件后，自动根据文件名（不含扩展名）在当前工作目录创建同名文件夹
- 将上传的 .docx 文件放入该文件夹
- 所有拆分生成的文件均输出到该文件夹

**方式二：Prompt 中给出文件名或文件路径**
- 根据用户提供的文件名或路径在文件目录中搜索匹配
- 找到 .docx 文件后，在其所在目录下创建同名文件夹（文件名不含扩展名）
- 所有拆分生成的文件均输出到该文件夹

**通用规则：**
- 输出目录 = `{源文件所在目录}/{源文件名（不含扩展名）}/`
- 不限定源文件必须位于 `files/` 目录，可在任意目录下操作

## 触发逻辑

1. **用户执行 `/split <文件路径> <拆分级别>`**：完整执行拆分流水线。
2. **自然语言触发**：用户说"把这个 TR 文档按三级标题拆分"等。
3. **拆分级别参数**：
   - `一级标题` / `level1` → 按 Heading 1 拆分
   - `二级标题` / `level2` → 按 Heading 2 拆分
   - `三级标题` / `level3` → 按 Heading 3 拆分

## 拆分流水线

### 步骤 0：解析输入参数

根据输入方式处理文件：

**方式一：对话框直接上传**
1. 接收用户上传的 .docx 文件
2. 获取文件名（如 `23801-01-080_clean.docx`）
3. 在当前工作目录创建同名文件夹（如 `23801-01-080_clean/`）
4. 将上传的文件移入/复制到该文件夹
5. 源文件路径 = `{工作目录}/{文件名（不含扩展名）}/{原始文件名}`

**方式二：Prompt 中提供文件名或路径**
1. 从用户 prompt 中提取文件名或路径
2. 在文件目录中搜索匹配的 .docx 文件（支持模糊匹配）
3. 确认文件存在且为 `.docx` 格式
4. 在文件所在目录下创建同名文件夹（如源文件为 `a/b/c.docx`，则创建 `a/b/c/`）
5. 源文件路径 = 找到的实际文件路径

**通用步骤：**
- 解析目标拆分级别（1/2/3）
- 确定输出目录 = 源文件所在目录 + 源文件名（不含扩展名）
- 若 `python-docx` 未安装，执行 `pip install python-docx`

### 步骤 1：读取文档 body XML 元素

**关键：遍历 `document.element.body` 的所有子元素，而非仅 `doc.paragraphs`**。

3GPP 文档 body 中包含两类子元素，缺一不可：
- `<w:p>` 段落（对应 `doc.paragraphs`）
- `<w:tbl>` 独立表格（不在 `doc.paragraphs` 中）

```python
from docx import Document

NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W_TBL = '{%s}tbl' % NS_W
W_P   = '{%s}p'   % NS_W

src_doc   = Document(src_file)
body      = src_doc.element.body
all_elems = list(body)   # 包含段落和表格

# 建立 elem_id -> para 对象的映射，用于检测段落 style
para_obj_map = {}
for para in src_doc.paragraphs:
    para_obj_map[id(para._element)] = para
```

### 步骤 2：按目标级别构建章节（核心逻辑）

**核心规则：只有 `level <= TARGET_LEVEL` 的标题才触发新章节。`level > TARGET_LEVEL` 的标题（如 H4/H5 在拆分 H3 时）作为内容元素归入当前章节。**

```python
def heading_level(para):
    """返回标题级别(1-9)，非标题返回 None"""
    if para.style and para.style.name:
        m = re.match(r'^Heading\s+(\d+)$', para.style.name)
        if m: return int(m.group(1))
    return None

def extract_section_number(text):
    """提取章节号，同时支持：
    - 纯数字章节号：1, 1.1, 1.1.1
    - 附录字母前缀：A.1, A.1.2, C.1, C.1.1
    """
    m = re.match(r'^([A-Za-z]?[\d]+(?:\.[\d]+)*)', text.strip())
    return m.group(1) if m else None

all_sections = []
current_heading1 = None
current_heading2 = None
current_section  = None

for elem in all_elems:
    if elem.tag == W_P:
        para_obj = para_obj_map.get(id(elem))
        if para_obj is None:
            continue
        lvl  = heading_level(para_obj)
        text = para_obj.text.strip()

        if lvl is not None and text:
            if lvl <= TARGET_LEVEL:
                # H1/H2/H3：结束当前章节，开始新章节
                if current_section is not None:
                    all_sections.append(current_section)

                sec_num = extract_section_number(text)
                if lvl == 1:
                    current_heading1 = {"level": 1, "number": sec_num, "title": text}
                    current_heading2 = None
                elif lvl == 2:
                    current_heading2 = {"level": 2, "number": sec_num, "title": text}

                current_section = {
                    "level":    lvl,
                    "number":   sec_num,
                    "title":    text,
                    "heading1": current_heading1.copy() if current_heading1 else None,
                    "heading2": current_heading2.copy() if current_heading2 else None,
                    "elements": [],
                }
                # 注意：标题元素本身不加入 elements（避免与 add_heading 重复）
            else:
                # H4/H5/...：作为内容元素归入当前章节
                if current_section is not None:
                    current_section["elements"].append(elem)
            continue

        if current_section is not None:
            current_section["elements"].append(elem)

    elif elem.tag == W_TBL:
        if current_section is not None:
            current_section["elements"].append(elem)

if current_section is not None:
    all_sections.append(current_section)
```

### 步骤 3：确定输出单元

```python
output_chunks = []
for sec in all_sections:
    lvl, num = sec["level"], sec["number"] or ""

    if lvl == TARGET_LEVEL:
        # 目标级别章节 → 直接输出
        output_chunks.append(sec)
    elif lvl == 2:
        # H2 无 H3 子章节 → 单独输出
        has_h3 = any(s["level"] == 3 and (s["number"] or "").startswith(num + ".")
                     for s in all_sections)
        if not has_h3:
            output_chunks.append(sec)
    elif lvl == 1:
        # H1 无 H2 子章节 → 单独输出
        has_h2 = any(s["level"] == 2 and (s["number"] or "").startswith(num + ".")
                     for s in all_sections)
        if not has_h2:
            output_chunks.append(sec)
```

### 步骤 4：格式部件迁移 + XML 深度拷贝 + 图片迁移生成文档

**绝对不能用 `para.text` 复制**，这会丢失图片和格式。必须用 XML 深度拷贝。

#### 4.0 格式部件迁移（每个新文档必须执行）

3GPP 文档使用大量自定义样式（TH、EX、B1/B2 列表、Editor's Note 等），这些定义存储在 4 个 OOXML 部件中。**每个输出文档创建后，第一步必须从源文档迁移这 4 个格式部件**，否则自定义样式将回退为默认格式。

| 部件 | 关系类型 | 内容 | 迁移方式 |
|------|---------|------|---------|
| styles.xml | `.../relationships/styles` | 208 个样式定义（TH/EX/B1 等） | XML element deepcopy |
| numbering.xml | `.../relationships/numbering` | 列表编号定义（numId 映射） | XML element deepcopy |
| theme1.xml | `.../relationships/theme` | 主题颜色/字体 | blob 拷贝（二进制部件） |
| fontTable.xml | `.../relationships/fontTable` | 字体映射表 | blob 拷贝（二进制部件） |

```python
from docx.opc.part import Part
from docx.opc.packuri import PackURI

STYLES_RT    = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'
NUMBERING_RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'
THEME_RT     = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'
FONTTABLE_RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable'

def find_part_by_reltype(doc_part, reltype):
    for rid, rel in doc_part.rels.items():
        if rel.reltype == reltype:
            return rel.target_part
    return None

def copy_part(src_doc, dst_doc, reltype):
    """复制 part（自动适配 XML 部件和二进制部件）"""
    src_part = find_part_by_reltype(src_doc.part, reltype)
    if src_part is None: return False
    dst_part = find_part_by_reltype(dst_doc.part, reltype)

    if dst_part is not None:
        if hasattr(dst_part, '_element') and hasattr(src_part, '_element'):
            dst_part._element = deepcopy(src_part._element)  # XML 部件
        else:
            dst_part._blob = src_part._blob                   # 二进制部件
    else:
        new_part = Part(PackURI(src_part.partname), src_part.content_type,
                        src_part.blob, dst_doc.part.package)
        dst_doc.part.relate_to(new_part, reltype)
    return True

def migrate_all_formatting(src_doc, dst_doc):
    """迁移全部格式部件，清除 styles 缓存"""
    for rt in [STYLES_RT, NUMBERING_RT, THEME_RT, FONTTABLE_RT]:
        copy_part(src_doc, dst_doc, rt)
    if hasattr(dst_doc, '_styles'):
        del dst_doc._styles  # 强制从新 element 重新加载
```

> **关键**：`dst_doc._styles` 缓存在 `Document()` 构造时即加载默认样式，替换 `_element` 后必须 `del dst_doc._styles` 才能生效。

#### 4.1 图片关系迁移

3GPP 文档图片存储格式：
- **现代格式**：`<a:blip r:embed="rIdXX">`（NS_A + NS_R）
- **VML 格式**：`<v:imagedata r:id="rIdXX">`（NS_V + NS_R）

图片关系迁移函数：

```python
NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS_V = 'urn:schemas-microsoft-com:vml'

def get_elem_rids(elem):
    """从 XML 元素中提取所有图片关系的 rId"""
    rids = set()
    for blip in elem.iter('{%s}blip' % NS_A):
        rid = blip.get('{%s}embed' % NS_R)
        if rid: rids.add(rid)
    for vimg in elem.iter('{%s}imagedata' % NS_V):
        rid = vimg.get('{%s}id' % NS_R)
        if rid: rids.add(rid)
    return rids

def transfer_images_for_elem(src_doc, dst_doc, elem):
    """迁移图片关系并更新 rId"""
    rid_map = {}
    for rid in get_elem_rids(elem):
        if rid in rid_map: continue
        try:
            src_rel    = src_doc.part.rels[rid]
            image_part = src_rel.target_part
            new_rid    = dst_doc.part.relate_to(image_part, src_rel.reltype)
            rid_map[rid] = new_rid
        except Exception:
            pass
    for old_rid, new_rid in rid_map.items():
        for blip in elem.iter('{%s}blip' % NS_A):
            if blip.get('{%s}embed' % NS_R) == old_rid:
                blip.set('{%s}embed' % NS_R, new_rid)
        for vimg in elem.iter('{%s}imagedata' % NS_V):
            if vimg.get('{%s}id' % NS_R) == old_rid:
                vimg.set('{%s}id' % NS_R, new_rid)
```

> **重要**：使用 `elem.iter('{ns}tag')` 而不是 `elem.xpath()`，因为 python-docx 的 `BaseOxmlElement.xpath()` 不支持 `namespaces` 关键字参数。

#### 4.2 生成输出文档

```python
from copy import deepcopy

for chunk in output_chunks:
    dst = Document()

    # ★ 第一步：迁移格式部件（styles/numbering/theme/fontTable）
    migrate_all_formatting(src_doc, dst)

    # 补充上级标题
    if chunk["heading1"] and chunk["level"] > 1:
        dst.add_heading(chunk["heading1"]["title"], level=1)
    if chunk["heading2"] and chunk["level"] > 2:
        dst.add_heading(chunk["heading2"]["title"], level=2)
    dst.add_heading(chunk["title"], level=min(chunk["level"], 3))

    # 逐元素深度拷贝（段落 + 表格 + 图片）
    for elem in chunk["elements"]:
        new_elem = deepcopy(elem)
        transfer_images_for_elem(src_doc, dst, new_elem)
        dst.element.body.append(new_elem)

    # 保存
    sec_num_str = (chunk["number"] or "0").replace(".", "_")
    title_part  = sanitize_filename(chunk["title"] or "untitled")
    filename    = f"{sec_num_str}_{title_part}.docx"
    dst.save(os.path.join(OUTPUT_DIR, filename))
```

### 步骤 5：质量验证

生成后必须抽查验证：
1. 统计非空文档数（`elem_count > 0`）
2. 抽查含图片最多的 5 个文档：段落数、表格数、图片数
3. **格式一致性验证**：对比源文档与输出文档的自定义样式定义（alignment、indent、bold、font、color），确保全部 MATCH
4. 验证自定义样式在输出文档中实际被使用（如 B1、TH、Editor's Note 等）

### 步骤 6：输出报告

包含：格式部件迁移状态、生成文档数、迁移图片总数、非空文档数、空文档列表（如有）、样式一致性对比结果、前 25 个文件清单。

## 文件命名规则

| 章节号 | 章节名 | 输出文件名 |
|--------|--------|-----------|
| 1.1.1 | Scope | `1_1_1_Scope.docx` |
| 6.2.1 | Solution variant #2.1 | `6_2_1_Solution_variant_#2.1...docx` |

- 章节号中 `.` → `_`
- 文件名非法字符 `<>:"/\|?*` → `_`
- 章节名截取前 80 字符

## 异常处理

1. **文件不存在**：报告错误，用 Glob 搜索相似文件名
2. **文档无标题结构**：报告"未检测到标题样式"
3. **拆分级别高于文档实际级别**：自动降级到文档实际最高级别
4. **python-docx 未安装**：`pip install python-docx`

## 硬约束

- **不修改源文件**：拆分过程绝对不修改原始 `.docx`
- **格式部件迁移**：每个输出文档必须迁移 styles.xml、numbering.xml、theme1.xml、fontTable.xml 四个部件
- **清除 styles 缓存**：替换 `_element` 后必须 `del dst_doc._styles`，否则样式不生效
- **XML 深度拷贝**：必须用 `deepcopy(elem)` 而非 `para.text` 复制，保留图片/表格/格式
- **图片关系迁移**：必须同时迁移 `a:blip`（现代）和 `v:imagedata`（VML）两种格式
- **表格不遗漏**：遍历 `body` 子元素（含 `w:tbl`），不能仅遍历 `doc.paragraphs`
- **H4/H5 归入父节**：`level > TARGET_LEVEL` 的标题是内容，不触发新章节
- **章节号支持附录前缀**：正则 `^([A-Za-z]?[\d]+(?:\.[\d]+)*)` 同时匹配 `1.1.1` 和 `A.1.2`
- **输出目录隔离**：所有输出文件存放在独立的同名文件夹中
- **使用简体中文**：所有报告和交互信息使用简体中文

## 已知陷阱

| 陷阱 | 错误做法 | 正确做法 |
|------|---------|---------|
| 仅遍历 paragraphs | 遗漏独立表格 `w:tbl` | 遍历 `body` 的所有子元素 |
| `para.text` 复制内容 | 丢失图片和格式 | `deepcopy(elem)` XML 深度拷贝 |
| `elem.xpath()` + namespaces | `BaseOxmlElement` 不支持 | 用 `elem.iter('{ns}tag')` |
| H4/H5 独立成节 | H3 文档内容为空 | H4/H5 作为 H3 章节的内容元素 |
| 仅迁移 `a:blip` 图片 | 遗漏 VML `v:imagedata` 图片 | 两种格式都迁移 |
| 不迁移 styles.xml | 自定义样式（TH/EX/B1 等）回退为默认格式 | 每个新文档迁移 4 个格式部件 |
| 不迁移 numbering.xml | B1/B2 列表编号丢失 | 随 styles 一起迁移 |
| 替换 _element 后不清缓存 | `dst.styles` 返回旧默认样式 | `del dst_doc._styles` |
| theme/fontTable 用 _element | 二进制部件无 _element 属性 | 判断 hasattr 后用 `_blob` 拷贝 |
| 章节号正则不含字母前缀 | `A.1`、`C.1` 等附录章节号无法提取 | 正则加入 `[A-Za-z]?` 前缀 |

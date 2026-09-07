---
archived: false
name: 3gpp-doc2md
description: 将 3GPP 提案文档（.docx / .pptx / .doc / .pdf）批量转换为 Markdown 并归档到 raw/01-proposals/。自动根据文件格式选择对应的转换链。当 3gpp-review 完成提案分析后需要归档原始文档时调用此 skill。触发词："转换提案"、"归档提案"、"doc2md"、"转换为 markdown"。
user-invocable: true
---

# 3GPP 提案文档 → Markdown 转换

将 `standards/` 目录下的 3GPP 提案原始文档批量转换为 Markdown，输出到 `raw/01-proposals/`，供后续 `/ingest` 工作流处理。

## 支持的格式与转换链

| 源格式 | 转换链 | 依赖 |
|--------|--------|------|
| `.docx` | pandoc → `.md` | pypandoc + pandoc |
| `.pptx` | pandoc → `.md` | pypandoc + pandoc |
| `.doc` | LibreOffice → `.docx` → pandoc → `.md` | LibreOffice + pypandoc + pandoc |
| `.pdf` | pdfplumber 提取文本+表格 → `.md` | pdfplumber (`pip install pdfplumber`) |

## 在 3gpp-review 工作流中的位置

本 skill 对应 `3gpp-review` 的 **Step 7**。标准工作流：

```
3gpp-review Step 0-6: 下载 → 提取文本 → 分析 → 生成总结 MD
         ↓
3gpp-doc2md (Step 7):  将 docs/ 下的原始文档转为 .md → raw/01-proposals/
         ↓
/ingest:               读取 raw/01-proposals/ → 编译到 wiki/ → 归档到 raw/09-archive/
```

执行完 3gpp-review 的 Step 6（生成总结）后，**必须**执行本 skill 完成原始文档归档。

## 执行步骤

### 1. 确定参数

从用户输入或 3gpp-review 上下文中获取：

- **输入目录**：`standards/KI{KI号}_TDocs_{会议号}/docs/`
- **输出目录**：`raw/01-proposals/`（默认）

### 2. 写出转换脚本并执行

将下方「转换脚本」章节中的完整 Python 代码写入临时文件 `_doc2md.py`，然后执行：

```powershell
$env:PYTHONIOENCODING = "utf-8"
python _doc2md.py "<输入目录>" "raw\01-proposals" --recursive --flat
```

转换完成后删除临时脚本：

```powershell
rm _doc2md.py
```

### 3. 验证结果

检查输出目录中新增的 .md 文件数量是否与输入文档数匹配。

## 输出文件命名规则

使用 `--flat` 模式时，脚本从文件名中提取提案号作为 .md 文件名：

```
S2-2606810.docx                        → S2-2606810.md
S2-2607030_rev1.pptx                   → S2-2607030.md
S2-2607682_[KI#18...] Solution.doc     → S2-2607682.md
S2-2607089_[KI#18...] Discussion.pdf   → S2-2607089.md
```

提取规则：匹配文件名开头的 `{WG前缀}-{数字}` 模式（如 `S2-2600098`、`S1-2500123`）。同一提案号出现多次时自动添加 `_v2`、`_v3` 后缀。

## 依赖安装

```powershell
# Python 依赖（pandoc 由 pypandoc 自动下载）
pip install pypandoc pdfplumber

# LibreOffice（仅 .doc 文件需要）
winget install TheDocumentFoundation.LibreOffice
```

| 你只需要转... | 需要安装 |
|--------------|---------|
| 仅 .docx / .pptx | `pypandoc`（pandoc 自动下载） |
| .doc | 上述 + `LibreOffice` |
| .pdf | `pdfplumber` |
| 全部格式 | `pypandoc` + `pdfplumber` + `LibreOffice` |

## 故障排除

### UnicodeEncodeError: 'gbk' codec
运行前设置 `$env:PYTHONIOENCODING = "utf-8"`。

### .doc 转换失败："LibreOffice 未安装"
安装 LibreOffice 并确认 `C:\Program Files\LibreOffice\program\soffice.exe` 存在。

### .pdf 转换内容为空
该 PDF 可能是扫描件（图片型），pdfplumber 只支持原生文本型 PDF。扫描件需 OCR 处理（当前不支持）。

### pandoc 找不到
`pip install pypandoc` 会自动下载。若失败，手动安装：https://pandoc.org/installing.html

## 转换后的目录结构

```
raw\01-proposals\               ← 所有提案 .md 统一存放（flat）
├── S2-2606810.md
├── S2-2606869.md
├── ...
└── (等待 /ingest 处理并归档到 raw/09-archive/)

standards\KI{KI号}_TDocs_{会议号}\
├── docs\                        ← 原始文档（保留，不删除）
├── texts\                       ← 提取的 .txt（中间产物）
├── figures\                     ← 提取的图示 PNG
└── {会议号}_KI{KI号}.md         ← Step 6 生成的总结
```

---

## 转换脚本

> **使用说明**：将下方代码块完整写入 `_doc2md.py`，执行 `python _doc2md.py <输入目录> <输出目录> --recursive --flat`，完成后删除 `_doc2md.py`。

```python
"""
3GPP 提案批量转换脚本
将指定文件夹下的 .docx / .pptx / .doc / .pdf 文件转换为 .md 文件

用法:
  python _doc2md.py <输入目录> <输出目录> [--recursive] [--flat]

参数:
  --recursive / -r : 递归扫描子目录
  --flat           : 所有 .md 直接输出到目标目录根，不建子目录；
                     文件名只保留提案号（如 S2-2600098.md）

支持格式与转换链:
  .docx  → pandoc → .md
  .pptx  → pandoc → .md
  .doc   → LibreOffice → .docx → pandoc → .md
  .pdf   → pdfplumber → .md

依赖:
  - pypandoc + pandoc (docx/pptx)
  - LibreOffice (doc，需安装到系统 PATH 或默认路径)
  - pdfplumber (pdf，pip install pdfplumber)
"""

import os
import re
import sys
import subprocess
import tempfile
import shutil


# ============================================================
# 依赖检查
# ============================================================

def check_pandoc():
    """检查并返回 pandoc 路径"""
    try:
        import pypandoc
        path = str(pypandoc.get_pandoc_path())
        return path
    except ImportError:
        print("❌ 缺少依赖: pypandoc")
        print("   请先运行: pip install pypandoc")
        return None
    except OSError:
        print("❌ 未检测到 Pandoc，正在自动下载安装...")
        try:
            import pypandoc
            pypandoc.download_pandoc()
            print("✅ Pandoc 安装完成")
            return str(pypandoc.get_pandoc_path())
        except Exception as e:
            print(f"❌ Pandoc 自动安装失败: {e}")
            return None


def find_libreoffice():
    """查找 LibreOffice soffice 可执行文件路径"""
    # 常见安装路径 (Windows)
    candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path

    # 尝试 PATH
    try:
        result = subprocess.run(
            ["soffice", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return "soffice"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return None


def check_pdfplumber():
    """检查 pdfplumber 是否可用"""
    try:
        import pdfplumber
        return True
    except ImportError:
        print("❌ 缺少依赖: pdfplumber")
        print("   请先运行: pip install pdfplumber")
        return False


# ============================================================
# 工具函数
# ============================================================

def extract_proposal_number(filename):
    """从文件名中提取提案号，如 S2-2600098_rev1.docx → S2-2600098"""
    name = os.path.splitext(filename)[0]
    m = re.match(r'^([A-Z]\d+-\d+)', name, re.IGNORECASE)
    if m:
        return m.group(1)
    # 回退：使用去掉扩展名的完整文件名
    return name


def collect_files(input_dir, extensions, recursive=False):
    """收集指定扩展名的文件列表"""
    files = []
    if recursive:
        for root, dirs, filenames in os.walk(input_dir):
            for f in filenames:
                if f.lower().endswith(extensions) and not f.startswith('~$'):
                    files.append(os.path.join(root, f))
    else:
        for f in os.listdir(input_dir):
            full_path = os.path.join(input_dir, f)
            if os.path.isfile(full_path) and f.lower().endswith(extensions) and not f.startswith('~$'):
                files.append(full_path)
    return files


def resolve_output_path(filename, output_dir, input_dir, file_path, flat, recursive, used_names):
    """解析输出 .md 文件路径"""
    if flat:
        prop_num = extract_proposal_number(filename)
        md_filename = prop_num + '.md'
        if prop_num in used_names:
            used_names[prop_num] += 1
            md_filename = f"{prop_num}_v{used_names[prop_num]}.md"
        else:
            used_names[prop_num] = 1
        return os.path.join(output_dir, md_filename), md_filename
    else:
        md_filename = os.path.splitext(filename)[0] + '.md'
        if recursive:
            rel_dir = os.path.relpath(os.path.dirname(file_path), input_dir)
            out_sub_dir = os.path.join(output_dir, rel_dir)
            os.makedirs(out_sub_dir, exist_ok=True)
        else:
            out_sub_dir = output_dir
        return os.path.join(out_sub_dir, md_filename), md_filename


# ============================================================
# 转换器: .docx / .pptx → .md (via pandoc)
# ============================================================

def convert_office_to_md(file_path, md_path, pandoc_path):
    """用 pandoc 将 .docx 或 .pptx 转换为 .md"""
    result = subprocess.run(
        [
            pandoc_path,
            str(file_path),
            '-t', 'markdown',
            '-o', str(md_path),
            '--wrap=none',
            '--markdown-headings=atx'
        ],
        capture_output=True,
        text=True,
        timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


# ============================================================
# 转换器: .doc → .md (via LibreOffice → pandoc)
# ============================================================

def convert_doc_to_md(file_path, md_path, pandoc_path, lo_path):
    """
    将 .doc (Word 97-2003) 转换为 .md
    转换链: .doc → LibreOffice → .docx → pandoc → .md
    """
    if not lo_path:
        raise RuntimeError("LibreOffice 未安装，无法处理 .doc 文件")

    temp_dir = tempfile.mkdtemp(prefix="doc2md_")
    try:
        # Step 1: .doc → .docx (LibreOffice headless)
        result = subprocess.run(
            [
                lo_path,
                '--headless',
                '--convert-to', 'docx',
                '--outdir', temp_dir,
                str(file_path)
            ],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode != 0:
            raise RuntimeError(f"LibreOffice 转换失败: {result.stderr.strip()}")

        # 找到生成的 .docx 文件
        docx_files = [f for f in os.listdir(temp_dir) if f.lower().endswith('.docx')]
        if not docx_files:
            raise RuntimeError("LibreOffice 未生成 .docx 文件")

        docx_path = os.path.join(temp_dir, docx_files[0])

        # Step 2: .docx → .md (pandoc)
        convert_office_to_md(docx_path, md_path, pandoc_path)

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ============================================================
# 转换器: .pdf → .md (via pdfplumber)
# ============================================================

def convert_pdf_to_md(file_path, md_path):
    """用 pdfplumber 将 .pdf 转换为 .md（提取文本 + 表格）"""
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber 未安装，请先运行: pip install pdfplumber")

    text_parts = []

    with pdfplumber.open(file_path) as pdf:
        for i, page in enumerate(pdf.pages):
            # 提取文本
            page_text = page.extract_text()
            if page_text:
                text_parts.append(f"<!-- Page {i + 1} -->\n\n{page_text}")

            # 提取表格
            tables = page.extract_tables()
            if tables:
                for t_idx, table in enumerate(tables):
                    text_parts.append(f"\n[Table {t_idx + 1}]")
                    for row in table:
                        cleaned_row = [
                            str(cell).replace('\n', ' ') if cell else ''
                            for cell in row
                        ]
                        text_parts.append(" | ".join(cleaned_row))
                    text_parts.append("")

    md_content = "\n\n".join(text_parts)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)


# ============================================================
# 主转换调度
# ============================================================

def convert_all(input_dir, output_dir, recursive=False, flat=False):
    """
    扫描输入目录，根据文件扩展名路由到对应的转换器

    支持: .docx, .pptx, .doc, .pdf
    """
    input_dir = os.path.normpath(input_dir)
    output_dir = os.path.normpath(output_dir)

    if not os.path.isdir(input_dir):
        print(f"❌ 输入路径不存在或不是文件夹: {input_dir}")
        return

    os.makedirs(output_dir, exist_ok=True)

    # ---- 依赖检查 ----
    pandoc_path = check_pandoc()
    if not pandoc_path:
        print("❌ pandoc 不可用，无法继续")
        sys.exit(1)

    lo_path = find_libreoffice()
    pdfplumber_ok = check_pdfplumber()

    # ---- 收集文件 ----
    ALL_EXTS = ('.docx', '.pptx', '.doc', '.pdf')
    all_files = collect_files(input_dir, ALL_EXTS, recursive)

    if not all_files:
        print(f"⚠️  未找到任何 .docx/.pptx/.doc/.pdf 文件（已跳过 ~$ 临时文件）")
        return

    # 按格式分类统计
    by_ext = {}
    for f in all_files:
        ext = os.path.splitext(f)[1].lower()
        by_ext.setdefault(ext, []).append(f)

    print(f"\n📂 源文件夹:   {input_dir}")
    print(f"📁 输出文件夹: {output_dir}")
    if flat:
        print(f"📋 模式: flat（提案号命名，无子目录）")
    print(f"📄 找到 {len(all_files)} 个文件:")
    for ext, files in sorted(by_ext.items()):
        method = {'.docx': 'pandoc', '.pptx': 'pandoc', '.doc': 'LibreOffice+pandoc', '.pdf': 'pdfplumber'}.get(ext, '?')
        print(f"   {ext}: {len(files)} 个 → {method}")
    if not lo_path and '.doc' in by_ext:
        print(f"\n⚠️  LibreOffice 未检测到！.doc 文件将无法转换。")
        print(f"   请安装 LibreOffice 后重试。")
    print()
    print("-" * 60)

    # ---- 逐个转换 ----
    success_count = 0
    fail_count = 0
    skip_count = 0
    used_names = {}

    for i, file_path in enumerate(all_files, 1):
        filename = os.path.basename(file_path)
        ext = os.path.splitext(filename)[1].lower()

        md_path, md_filename = resolve_output_path(
            filename, output_dir, input_dir, file_path, flat, recursive, used_names
        )

        print(f"[{i}/{len(all_files)}] {filename}")

        try:
            if ext in ('.docx', '.pptx'):
                convert_office_to_md(file_path, md_path, pandoc_path)

            elif ext == '.doc':
                if not lo_path:
                    print(f"          → ⏭️  跳过 (LibreOffice 未安装)")
                    skip_count += 1
                    continue
                convert_doc_to_md(file_path, md_path, pandoc_path, lo_path)

            elif ext == '.pdf':
                if not pdfplumber_ok:
                    print(f"          → ⏭️  跳过 (pdfplumber 未安装)")
                    skip_count += 1
                    continue
                convert_pdf_to_md(file_path, md_path)

            else:
                print(f"          → ⏭️  跳过 (不支持的格式: {ext})")
                skip_count += 1
                continue

            print(f"          → ✅ {md_filename}")
            success_count += 1

        except Exception as e:
            print(f"          → ❌ 转换失败: {e}")
            fail_count += 1

    # ---- 汇总 ----
    print("-" * 60)
    print(f"\n🏁 转换完成！成功 {success_count}，失败 {fail_count}，跳过 {skip_count}")
    print(f"   总计 {len(all_files)} 个文件\n")


# ============================================================
# CLI 入口
# ============================================================

def main():
    print("=" * 50)
    print("   3GPP 提案批量转换工具 (docx/pptx/doc/pdf → md)")
    print("=" * 50)

    if len(sys.argv) >= 3:
        input_dir = sys.argv[1]
        output_dir = sys.argv[2]
        recursive = '--recursive' in sys.argv or '-r' in sys.argv
        flat = '--flat' in sys.argv
    else:
        # 交互式输入
        input_dir = input("\n请输入源文件夹路径（存放文档的文件夹）: ").strip().strip('"').strip("'")
        output_dir = input("请输入输出文件夹路径（md 保存位置）: ").strip().strip('"').strip("'")
        recursive_input = input("是否递归处理子文件夹？(y/N): ").strip().lower()
        recursive = recursive_input in ('y', 'yes')
        flat_input = input("是否使用 flat 模式（提案号命名，无子目录）？(y/N): ").strip().lower()
        flat = flat_input in ('y', 'yes')

    convert_all(input_dir, output_dir, recursive=recursive, flat=flat)


if __name__ == "__main__":
    main()
```

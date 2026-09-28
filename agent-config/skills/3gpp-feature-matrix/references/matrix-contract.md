# 立场记录和矩阵

`stance-records.json` 保存本次范围、文档清单、维度和记录：

```json
{
  "scope": {"meeting": "用户指定的会议", "topic": "用户指定的主题", "snapshot": "ISO 日期时间"},
  "documents": [{"tdoc": "S2-2600001", "source": "Example Corp", "companies": ["Example Corp"], "path": "原文路径", "status": "available"}],
  "dimensions": [{"id": "request-path", "name": "请求路径", "options": ["NAS", "AF"], "exclusive": false}],
  "records": [{"company": "Example Corp", "tdoc": "S2-2600001", "dimension": "request-path", "option": "NAS", "stance": "support", "strength": "explicit", "evidence": {"locator": "第 6.1 节，第 3 段", "text": "准确转述或短引用", "kind": "paraphrase"}}],
  "failures": []
}
```

这是字段示例，不是会议事实。TDoc、来源和引用必须从输入资料取得。

联合提案的 `companies` 必须按原文署名拆分；不要凭缩写或分隔符猜公司归属。单一来源可省略该数组。把文件保留在参考资料中，不必为没有立场的公司编造记录。

立场分类采用 review 包的 `references/stance-evidence.md`。`support / oppose / concern / alternative / neutral` 分别展示为支持、明确反对、保留意见、替代方案、中性说明。`oppose` 必须为 `explicit`，每条记录必须有原文位置和非空依据。

没有记录的单元格显示“资料不足”；已检查该公司的相关材料但不涉及该维度时可显示“未涉及”，并记录检查范围。二者都不能显示为反对。

同公司同选项存在相反记录时展示“存在不同主张”，列出 TDoc、日期、适用条件；只有原文明确说明替代关系时才使用最新版本覆盖旧立场。单元格中的证据编号必须能回到 records 中的具体记录。

公司列表来自 documents 和 records，不使用固定名单。维度数量来自资料，不设下限。联合署名、修订标记和选项互斥性不能代替原文支持检查。

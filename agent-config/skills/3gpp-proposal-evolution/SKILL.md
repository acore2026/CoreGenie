---
name: 3gpp-proposal-evolution
description: "Compare proposals between two 3GPP meetings: establish revision chains and cross-meeting candidates, identify new technical content, and analyze each chain against user-supplied viewpoints. Not for download-only tasks or long-term company position studies."
---

# 两次会议的提案前后分析

先加载本 Skill 和已绑定的 `3gpp-review`，再规划。review 负责资料获取、保留修订的提取和图表检查，不执行另一套报告流程。Skill 加载、读取契约、检查目录、整理临时元数据和内部校验都是实现步骤，不要放进用户可见的任务清单；任务清单只写用户要求的资料处理、分析、验证和交付结果。

## 工作流

1. 明确前后两次会议、工作组、KI/WI、Release、TR/TS、范围、资料快照时间。用户只要求本地资料时不要扩大联网检索。未提供我方观点时可询问一次；没有答复仍继续，但不推断我方立场。
2. 复用已有资料；需要获取会议资料时按 review 调用 `3gpp.download`。保留真实清单和缺失项，不把下载记录当成完整官方 Index。读取 [关系规则](references/relation-rules.md)。
3. 将真实元数据整理为两个 JSON 数组。每项包含 `tdoc`、`title`、`source`、`comments`、`result`，可提供 `clauses`（实际修改的章节）、`spec`、`wi`、`rel`、`localPath`。无法确认的字段留空，不伪造。可用下面的脚本生成初步关系和任务清单；它不做语义判定，也不证明新增。
4. 结合 review 的提取结果检查正文页眉、Introduction、修改章节及技术机制，补充有原文位置的关系记录。先完成前后关系总览、新增方案候选和新增技术内容，再逐条分析修订链。普通引用不是修订；同章节公共 TR 文本相同不证明继承。
5. 按本次会议的修订链逐条分析，保留全部中间稿。合并输入不并入修订链，单独分析并指向共同基线。一个跨会议链可以关联多个上次候选。上一会议缺少后继不等于退出。
6. 每条链都在当前 Agent 中完成资料读取、版本比较和结果写入，不调用其他 Agent，也不把链分析拆成子 Agent 任务。资料不足时记录具体缺口，不用猜测补齐。
7. 按 [报告契约](references/report-contract.md) 汇总。父 Agent 负责最终报告和可选发布；已完成的链结果不得被其他链的错误覆盖。

## 脚本与产物

在激活时返回的准确 skillRoot 下运行，不复制脚本到工作区：

```bash
python scripts/3gpp_proposal_evolution.py --previous /workspace/previous.json --next /workspace/next.json --output /workspace/_meta/tasks/<run-id>/proposal-evolution/relations.json
```

参数中的路径仅为示例，必须替换为已确认存在的真实文件。输入顺序由父 Agent 确认，脚本不会根据 TDoc 编号判断会议先后。

内部关系、提取和任务结果放在 `/workspace/_meta/tasks/<run-id>/proposal-evolution/`。最终中文 Markdown 放在 `/workspace/3gpp/comparisons/<run-id>/analysis/`，使用不覆盖既有文件的版本名。用户要求入库时父 Agent 才调用 `knowledge.publish`，发布失败保留文件并说明；不要将内部路径和调试字段写入报告正文。

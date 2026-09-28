---
archived: false
name: 3gpp-review-direct
description: 在一个连续 Agent 会话中分析已由 3gpp.download 准备好的 3GPP 提案，用于连续执行实验助手；不重复实现资料下载。
allowed-tools: skill.read_resource 3gpp.resolve-meeting 3gpp.download bash python filesystem.read filesystem.write filesystem.list filesystem.search web.fetch user.ask vision.inspect
---

# 连续提案分析

Complete this workflow in one continuous Agent conversation. Do not delegate batches to another Agent.

本 Skill 只规定执行方式。下载、提取和检查复用已绑定的 `3gpp-review`，不维护脚本副本。

1. 规划前激活本 Skill 和 `3gpp-review` 各一次。读取 review 包的 `references/research-workflow.md`，需要公司立场判断时读取 `references/stance-evidence.md`。
2. 在同一会话中分析 `/workspace/3gpp/<会议>-<KI>/proposal/` 中已准备好的文件。不调用其他 Agent，不创建多任务计划，不为了继续下一步重开模型上下文。
3. 如果资料目录不存在或缺少 TDoc，停止并调用 `3gpp.download`；不要用 Bash 或 Python 直接下载。
4. 分析结果写入同一任务目录的 `analysis/`，临时转换文件写入 `/workspace/tmp/3gpp/`，完成后清理。
5. 生成带日期的中文报告，读回文件检查引用与实际资料范围。议程引用下载不证明整个 KI 覆盖完整；没有官方 Index manifest 时不声称完成严格 coverage，列出尚未确认的范围。
6. 直接向用户交付报告和限制，不调用知识库发布工具。review 的发布步骤不适用于本模式。

公司提案、联合署名和会议结果分别说明；只有明确的原文证据才能判断反对。看不清的图和无法确认的状态直接说明。

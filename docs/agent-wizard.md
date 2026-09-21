# Agent 任务向导

在聊天输入框点击“任务向导”，填写后检查生成的提示词，再添加到草稿。已有草稿会保留，向导内容追加在后面；不会自动发送。切换 Agent 或对话后，表单状态不会混用。关闭向导会保留本次页面中的填写内容，刷新页面后清空。

## 配置

唯一配置来源是 `agent-config/agents/*.yaml` 的可选 `wizard` 字段。完整示例见 `3gpp-review.yaml`。未配置向导的 Agent 保持直接聊天。

- `version: 1`、`title`、`instructions` 和 `fields` 必填。
- `instructions` 是生成用户消息的开头，不替代 Agent 的系统提示词或 Skill。
- 字段包含 `id`、`label`、`type`，可选 `required`、`hint`、`placeholder`。
- `type` 支持 `text`、`textarea`、`single`、`multi`。
- 选择题的 `options` 包含 `value` 和 `label`；提示词使用可读的 label。
- `when` 是条件数组，例如 `[{ field: scope, values: [meeting] }]`。只允许引用排在前面的选择题。数组中的条件全部满足才显示；同一条件的 values 满足任意一个即可。多选按包含关系判断。
- 父问题隐藏时，子问题也隐藏。切换分支立即清除隐藏答案；隐藏问题不参加必填检查，也不生成提示词。
- 最多 30 个字段，每题最多 30 个选项，每个文本答案最多 4000 字符。

部署前先应用 SQLite 或 PostgreSQL 对应的 `20260921120000_agent_wizard` 迁移，并重新生成 Prisma 客户端。配置同步继续走现有机制；未开启同步的安装由 `agent_config_seed_v6` 初始化。旧客户端更新 Agent 时不传 wizard 不会清空已有向导，显式传 null 可以删除。

第一版不包含可视化表单设计器、文件上传题型或模型动态出题。文档附件继续使用聊天输入框的上传功能。

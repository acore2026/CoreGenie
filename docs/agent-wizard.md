# Agent 快捷任务

聊天输入框上方显示“快捷任务”卡片，示例消息放在输入框下方。填写后检查生成的提示词，再添加到草稿。已有草稿会保留，不会自动发送。切换 Agent 或对话后，表单状态不会混用。关闭向导保留本次页面的填写内容，刷新后清空。

## 配置

快捷任务是独立的共享配置，唯一配置来源是 `agent-config/quick-tasks/*.yaml`。Agent 通过 `quickTasks` 绑定一个或多个快捷任务，多个 Agent 可以复用同一任务。完整示例见 `agent-config/quick-tasks/proposal-topic-analysis.yaml`。旧 Agent YAML 中的 `wizard` 仍可读取，并会在同步或种子升级时迁移为共享任务。

- 每个快捷任务有稳定的 `id`、`version: 1`、`title`、`instructions` 和 `fields`，可附 `description`。单个任务配置最多 40000 字符，一个 Agent 最多绑定 12 个任务，合计最多 180000 字符（均按 JSON 序列化长度计算）；绑定顺序就是聊天中的显示顺序。
- `instructions` 是生成用户消息的开头，不替代 Agent 的系统提示词或 Skill。
- 字段包含 `id`、`label`、`type`，可选 `required`、`hint`、`placeholder`。
- `type` 支持 `text`、`textarea`、`single`、`multi`、`meeting`、`agenda`。文本题可附 `examples`，选项可附 `description`。选择题可用 `optionGroups` 分组，并用 `collapsed: true` 折叠次要选项。
- `meeting` 引用前面的 `groupField`。兼容旧的 `agenda` 题型，但提案分析助手不再使用它。
- 提案分析助手的 KI 使用按工作组显示的预置 `multi` 题型，选项统一以“KI#编号”开头并附中文简述。不显示普通议程项，不请求动态议程。更换工作组清空会议和旧 KI，更换会议保留 KI。
- KI 选项必须来自固定版本的官方研究报告，并保留 TR、版本、章节号。仅简述中文标题和描述，不自行创建研究方向。当前收录 SA2、SA3、SA5、SA6 和 CT4 的部分研究项目；其他工作组显示手动补充入口，不伪造选项。整理依据见 `agent-config/references/3gpp-ki-presets.md`。
- 选择题的 `options` 包含 `value` 和 `label`；提示词使用可读的 label。
- `when` 是条件数组，例如 `[{ field: scope, values: [meeting] }]`。只允许引用排在前面的选择题。数组中的条件全部满足才显示；同一条件的 values 满足任意一个即可。多选按包含关系判断。
- 父问题隐藏时，子问题也隐藏。切换分支立即清除隐藏答案；隐藏问题不参加必填检查，也不生成提示词。
- 最多 30 个字段，每题最多 30 个选项，每个文本答案最多 4000 字符。

管理页面可以新建、编辑、停用和预览快捷任务，并把任务绑定到 Agent。停用不会删除历史绑定，运行时会隐藏停用任务。生成的提示词只填入聊天草稿，不会自动发送。

部署前应用对应数据库的 `20260921120000_agent_wizard`、`20260922100000_standalone_quick_tasks`、`20260921160000_global_reference_catalog` 迁移，并重新生成 Prisma 客户端。配置同步继续走现有机制；未开启同步的安装由当前 seed 版本初始化。旧客户端仅提交 `wizard` 时，保存后立即迁移为共享任务并替换当前绑定；修改旧表单不会改动其他 Agent 使用的共享任务。省略 `wizard` 和 `quickTaskIds` 会保留绑定；`wizard: null` 或 `quickTaskIds: []` 可清空绑定。同时提交两者时，以 `quickTaskIds` 为准。

## 全局会议参考目录

会议和议程是结构化参考数据，不放进向量 RAG。数据库 `global_reference_entries` 为所有工作区保存同一份快照。快捷任务只动态读取会议；官方 KI 清单来自 Agent 配置中的预置选项，不依赖议程快照。议程接口继续供工具和旧配置使用。

- `3gpp/meetings/SA2`：工作组会议目录；`3gpp/agenda/SA2/<meeting-id>`：指定会议的议程。
- 后台任务 `sync-three-gpp-catalog` 启动 10 秒后首次运行，每 5 分钟检查到期项。会议列表和当年议程每 6 小时刷新，往年议程每 30 天刷新。首次启动预热各工作组的近期及后续已发布会议。
- 历史议程首次读取时登记后台任务，页面不等待官方网络请求，允许先手动填写。点击“重新读取”查看同步结果。
- 每份数据返回 `referenceKey`、内容哈希 `revision`、`fetchedAt`、`nextRefreshAt`、`pending`、`stale`、官方来源。版本是当前内容哈希，并非永久保留的历史版本；报告应同时保存所用内容和来源。
- 抓取并发数为 2；单项通过数据库租约防止多实例重复执行，进程退出后租约 3 分钟过期。网络失败 15 分钟后重试，保留上次成功的数据；具体原因保留在后台记录。
- 所有已登录用户通过 `GET /api/3gpp/catalog?group=SA2` 读取。增加 `meeting=<id>` 读取议程。Agent 可绑定 `3gpp.catalog` 工具，分页读取相同快照；不需要管理员身份，也不依赖工作区文件。
- 生产部署仍需保证现有 BackgroundWorkerService 启动及数据库迁移成功。此任务无需 LLM，不消耗模型调用。

### 资料限制

来源为 3GPP 官方 FTP 网页中的已发布目录和 HTML 议程，不是完整会议日历。目录没有日期时放入“年份待确认”，不能用文件修改日期推测年份。Word/PDF 议程暂未解析。工具返回的提案标题 KI 标记并非正式定义；快捷任务不再使用这些内容作为选项。上一次/下一次是相对于所选会议的目录顺序，不代表今天之前/之后的会议。会议目录和公司提案都不能证明方案已被采纳。

第一版不包含可视化表单设计器、文件上传题型或模型动态出题。文档附件继续使用聊天输入框的上传功能。

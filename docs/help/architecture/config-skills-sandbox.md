# 配置体系、Skill、工具与沙箱

> **所属层级**：L2 专题 · 开发与扩展视图 ｜ 返回 [架构总览](../architecture.md)
>
> **本文范围**：面向需要新增或调整 Agent、Skill、Tool 与脚本能力的开发者，说明配置如何从仓库进入运行时、能力如何分层加载，以及代码执行沙箱的隔离架构。

## 1. 配置单一来源：`agent-config/` 与双运行模式

CoreGenie 把所有共享提示词、预置 Agent、Skill 包、快捷任务表单和内置斜杠命令集中维护在仓库根目录的 [agent-config/](../../../agent-config/README.md)，服务端代码不再另存提示词副本：

```text
agent-config/
├── global-prompt.md          # 全局系统提示词
├── agents/<key>.yaml         # Agent 定义（runtimeKey、tools、skills、quickTasks、enabled、showInRoster）
├── quick-tasks/<key>.yaml    # 可复用任务向导表单（生成草稿，不自动发送）
├── skills/<key>/             # Skill 包（SKILL.md + references/ + scripts/）
└── commands/*.json           # 内置斜杠命令预设
```

为什么配置文件进入数据库会有**两种互斥模式**（由环境变量 `AGENT_CONFIG_SYNC_ENABLED` 切换）？因为生产环境与开发环境的诉求相反：

- **生产 / 标准镜像环境**：容器里只有打进镜像的只读 `/app/agent-config`，且管理员可能在 Web 后台直接微调提示词，重启容器不能把后台改动覆盖掉——因此默认走**种子初始化模式**，只在发版递增版本号时一次性导入。
- **本地开发 / 提示词迭代环境**：开发者希望在 IDE 里直接改 Git 文件就立刻生效，又能和 Web 后台编辑器双向互通——因此可选挂入宿主机目录并开启**仓库双向同步模式**。
- **必须互斥**：避免两个写入器同时操作同一批配置表导致互相覆盖或假冲突；开启同步时 `seed.js` 会自动跳过。

| 模式 | 适用环境 | 生效机制 | 开发与运维注意点 |
| --- | --- | --- | --- |
| **种子初始化模式（默认）** | 标准镜像部署、生产/离线环境 | [seed.js](../../../server/agent-skills/seed.js) 按统一版本号（当前 `agent_config_seed_v19`）在单事务内一次性导入 Skill → QuickTask → Agent | **改了预置配置却没升版本号，线上部署后不会生效**；必须递增种子版本并同步测试；管理员在 Web 后台的后续修改重启后保留 |
| **仓库双向同步模式** | 本地开发机、高频迭代提示词与 Skill 的环境 | [config-sync](../../../server/config-sync) 单进程每 2 秒扫描挂载目录，并与 Web 保存操作互斥串行；按上次同步哈希检测单边变更或双边冲突 | 启用时跳过种子更新；双边冲突需在后台「仓库配置同步 → 比较版本」人工选定；为防误删，删除文件不会删库记录，退役请设 `enabled: false` 或 `archived: true` |

> **关键设计**：Agent YAML 中引用 Skill 和 QuickTask 均使用**稳定的目录/文件 key**（而非数据库自增 ID），确保配置跨环境可移植；另可通过 `enabled: true` + `showInRoster: false` 定义仅供其他 Agent 通过 `agent.call` 委派的内部专职 Agent。详见 [仓库配置同步说明](../../agent-config-sync.md)。

## 2. 预置助手怎么区分：三类状态与五项核心差异

仓库 [agent-config/agents/](../../../agent-config/agents) 目前共有 10 个 Agent YAML，按 `enabled`（能否运行/被委派）和 `showInRoster`（是否展示在前端列表）分为三类：

- **前台展示的 3 个活跃助手**（`enabled: true`、`showInRoster: true`）：

| 助手名称 | 配置文件 | 运行引擎（`runtimeKey`） | 附件模式 | 工具权限 | 绑定 Skill | 快捷任务向导 |
| --- | --- | --- | --- | --- | --- | --- |
| **3GPP 提案分析助手** | [3gpp-general.yaml](../../../agent-config/agents/3gpp-general.yaml) | `default-react` | `workspace_file` | 全部（`null`） | 6 个（查会议/评审/立场/提案对比/PPT/转 MD） | 2 个 |
| **3GPP 技术路线与立场分析助手** | [3gpp-position-evolution.yaml](../../../agent-config/agents/3gpp-position-evolution.yaml) | `governed-agent` | `parsed` | 显式白名单（16 个） | 2 个（`3gpp-position-evolution`、`3gpp-review`） | 无 |
| **3GPP 文档拆分助手** | [3gpp-split-docx.yaml](../../../agent-config/agents/3gpp-split-docx.yaml) | `default-react` | 默认（`parsed`） | 全部（`null`） | 1 个（`3gpp-split-docx`） | 无 |

- **后台启用但隐藏的 2 个专职助手**（`enabled: true`、`showInRoster: false`）：[3gpp-markdown.yaml](../../../agent-config/agents/3gpp-markdown.yaml)（挂载 `workflow: 3gpp-markdown-conversion` 固定转换分支）与 [3gpp-feature-matrix.yaml](../../../agent-config/agents/3gpp-feature-matrix.yaml)，供其他助手通过 `agent.call` 委派或由特定评测/任务调用，避免前端列表过长。
- **已停用的 5 个实验/历史占位配置**（`enabled: false`、`showInRoster: false`）：含 `general-assistant.yaml`、`3gpp-review.yaml`、`3gpp-review-experimental.yaml`、`3gpp-proposal-analysis.yaml`、`evidence-research.yaml`；保留文件并用 `enabled: false` 标记，符合同步器的安全退役规则。

### 除了系统提示词，不同助手还有哪 5 项实质差异

很多新人以为“建一个新助手就是换一段 Prompt”，实际上决定助手行为和成本的是下面 5 个配置维度：

1. **底层运行引擎（`runtimeKey`）**：最大差异。`default-react` 是轻量单会话 ReAct 循环，响应快、Token 省；`governed-agent` 是多阶段状态图（规划 → 派发 → 复查 → 汇总），适合耗时较长的跨会议研究，但处理简单问答过重；`evidence-research` 为实验性并行检索运行时，当前未对用户启用。
2. **附件处理模式（`runtimeConfig.attachmentMode`）**：`workspace_file` 保留原始文件给沙箱脚本读取（保原图、修订与嵌入对象）；`parsed`（默认）走 `@coregenie/collector` 抽取纯文本，适合轻量检索与问答。
3. **绑定的 Skill 包（`skills`）**：决定助手具备哪些领域方法与沙箱脚本（如 DOCX 拆分、PPT 生成与渲染、跨会议立场统计），而不只是附加一段提示词。
4. **工具权限集（`tools`）**：`null` 表示开放全部已启用工具（并允许 `agent.call` 委派）；显式白名单则收紧能力边界，防止研究型助手误调无关操作。
5. **固定流程与任务向导（`workflow` / `quickTasks`）**：`workflow` 可在控制器命中确定性捷径（如单文件提案转 Markdown 跳过自由规划）；`quickTasks` 为前端生成结构化参数表单草稿（由用户确认后再发送）。

## 3. Skill 的三级来源与三阶段生效

![配置、Skill、Tool 与沙箱隔离关系：agent-config 经种子或同步写入配置库，Skill 按绑定、激活、执行三阶段进入任务，脚本类 Tool 通过 Unix Socket 委托独立 Broker 拉起受限一次性 Runner 容器执行。](../diagrams/sandbox-skill.svg)

### 3.1 三级作用域与优先级

为了让团队通用规范、项目私有方法和个人工作流互不干扰，[server/agent-skills/registry.js](../../../server/agent-skills/registry.js) 在任务开始前从三个层级拼装候选 Skill 列表：

1. **全局 Skill（`global`）**：由 Agent YAML 的 `skills` 字段显式绑定，存有不可变修订快照（`agent_skill_revisions`）。
2. **工作区私有 Skill（`workspace`）**：位于工作区目录 `/workspace/.agent/skills/<name>`；若与全局 Skill 重名，工作区版本会被标记为冲突无效，不覆盖全局定义。
3. **个人 Skill（`personal`）**：用户创建或订阅的私有 Skill，运行时自动分配不冲突的 `personal-<id>` 名称。

### 3.2 绑定 → 激活 → 执行

为避免把所有领域规则一次性塞爆模型上下文，Skill 采用延迟加载机制：

1. **绑定（目录可见）**：任务初始化时，模型只看到可用 Skill 的**名称与简介**。
2. **激活（加载说明）**：模型按需调用 `activate_skill`（或固定流程由代码直接激活）。[tools/skills.js](../../../server/tools/skills.js) 校验可见性后，记录本次任务激活的 Skill 名称、作用域与修订号，返回完整的 `SKILL.md` 正文与附带文件清单。**激活动作本身不执行任何脚本。**
3. **执行（按需读资源与跑脚本）**：模型或固定流程通过 `read_skill_resource` 读取参考文档，或通过 `bash` / `python` / 专用工具调用 Skill 包内脚本。

> **关于版本锁定**：新创建的 Agent 任务会锁定所绑定全局 Skill 的修订号；重启恢复时加载同一修订，避免任务中途因配置更新而前后规则不一致。

## 4. 统一工具层：`defineTool` 与执行约束

原生 LangChain Tool 只描述名称、入参 Schema 和执行函数，缺少重试策略、副作用区分、输出截断和审计能力。因此 CoreGenie 要求所有内置工具都在 [server/tools/index.js](../../../server/tools/index.js) 注册，并先通过 [defineTool](../../../server/tools/descriptor.js) 声明结构化约束，再统一包装为 LangChain Tool：

- **工具分类**：文件读写（`filesystem.*`）、沙箱脚本（`bash`、`python`）、知识库检索与发布（`knowledge.*`、全局知识库工具）、记忆（`memory.*`）、联网搜索/抓取（`web.*`）、3GPP 专用工具（`3gpp.resolve-meeting`、`3gpp.download`、`3gpp.convert-markdown`）、Skill 工具（`skill.*`）、视觉看图（`vision.inspect`）、人工输入（`ask_user`）与定时任务等。
- **元数据约束**：每个工具声明 `effect`（`read` / `write` / `destructive`）、`idempotency`（`safe` / `keyed` / `none`）、`retry`（读工具默认最多重试 2 次，写工具默认 1 次）、`maxResultBytes`（默认 32 KiB 截断防上下文膨胀）、`concurrencyKey` 与 `failureFamily`（同类失败熔断上限）。
- **审计与幂等键**：每次调用按 `sha256(toolId + 规范化参数)` 计算 `operationKey`，全量记录到 `agent_tool_executions` 表（含入参、状态、结果摘要、错误码和耗时），既是前端时间线的数据源，也是产物回收和故障排查的依据。

## 5. 代码执行沙箱：Broker + 一次性 Runner 隔离

让 Agent 在主服务端容器里直接跑 `bash` 或 `python` 风险极高（脚本可读主服务 `.env` 密钥、误改其他工作区文件，或死循环拖垮整个站点）；而把宿主机 `docker.sock` 直接挂给主服务容器同样危险。CoreGenie 采用**三层权限隔离**的沙箱架构（[sandbox/README.md](../../../sandbox/README.md)）：

1. **权限最小化分工**：
   - **主服务端容器**：**不挂载 Docker Socket**，仅通过共享存储卷访问 Broker 的 **Unix Socket** 与校验 Token。
   - **Broker 容器（[sandbox/sandbox_broker/](../../../sandbox/sandbox_broker)）**：极简受限容器，无外网权限，唯一持有 Docker Socket，负责校验 Token、参数白名单、并发排队，并创建和回收 Runner 容器。
   - **Runner 容器（一次性）**：每次工具调用启动一个全新的无特权容器，执行完立即销毁（连同 `/tmp`）。
2. **为什么选 Python 与 Docker，以及后续扩展方向**：
   - **Runner 依赖 Python + Bash 生态**：3GPP 文档处理（`python-docx` / `lxml`）、PPT 生成与渲染（`python-pptx` / LibreOffice / Noto 中文字体）以及大模型编写脚本，均以 Python 与 Bash 为主，依赖通过 `uv`（[sandbox/pyproject.toml](../../../sandbox/pyproject.toml)）统一锁定管理。
   - **Broker 采用纯标准库 Python（零第三方运行时依赖）**：Broker 镜像仅包含 `python:3.12-slim`、单个 `docker` 二进制与标准库代码，攻击面极窄，且与 Runner 共享基础镜像层，避免额外引入编译链或庞大的第三方依赖树。
   - **隔离核心由 Docker 提供**：Broker 本身不自研沙箱内核，隔离与资源限制完全依托成熟的 Docker（Linux namespaces + cgroups）。若未来面向公网多租户需要更强的防逃逸能力，可直接为 Runner 切换 **gVisor (`runsc`)** 或 **Kata Containers** 运行时而无需重写整体架构；若单机并发见顶，再将后端扩展到 Kubernetes Job 或分布式沙箱平台。
3. **文件系统挂载策略**：
   - 当前工作区以读写方式挂载到 `/workspace`（`pip install` 的额外依赖默认落盘到 `/workspace/.python`，同工作区后续调用可复用）。
   - 全局或个人 Skill 的特定修订仅在需要时以**只读方式**挂载到 `/skills/<name>`；环境变量 `SKILL_ROOT` 指向当前包，缓存重定向到 `/workspace/.agent/cache`。
   - 根文件系统设为只读，禁用 Linux Capabilities。
4. **默认资源上限与排队**：
   - 默认最大并发 **12** 个 Runner（`SANDBOX_MAX_CONCURRENCY`），满载时排队最多等待 **120 秒**（Broker 监听队列 128）。
   - 单 Runner 上限：**4 GiB 内存、2 CPU、512 进程/线程、4096 文件句柄、单文件 1 GiB、`/tmp` 512 MiB**；默认超时 **15 分钟**（硬上限 **120 分钟**）；脚本代码上限 **256 KiB**，合并 stdout/stderr 输出截断为 **1 MiB**。
   - 启动脚本额外维护一个无网络、只休眠的 **Image Guard 容器**，防止宿主机运行 `docker image prune -a` 时把 Runner 镜像清掉。

> **依赖更新提醒**：Runner 内置 Python 科学/文档包、`uv`、LibreOffice（用于 PPT/旧版 DOC 渲染）、`poppler-utils` 与 Noto 中文字体。修改 [sandbox/pyproject.toml](../../../sandbox/pyproject.toml)（并更新 `uv.lock`）或 Dockerfile 后必须重建 Runner 镜像；配置同步不会自动更新镜像里的运行依赖。

## 6. 二次开发入口速查

| 你想做什么 | 从哪里下手 | 必须同步做的事 |
| --- | --- | --- |
| 新增或调整预置 Agent 的职责、工具、Skill 绑定 | 编辑 [agent-config/agents/](../../../agent-config/agents) 下对应 YAML | 未开同步的环境须递增 [seed.js](../../../server/agent-skills/seed.js) 版本号，并更新相关单测 |
| 修改分析规范或文档转换脚本 | 编辑 [agent-config/skills/](../../../agent-config/skills) 的 `SKILL.md`、`references/`、`scripts/` | 运行 `server/__tests__/agent-skills/` 回归测试；若新增系统依赖需重建沙箱镜像 |
| 新增一种原子工具能力 | 在 `server/tools/` 使用 `defineTool` 实现，并在 [server/tools/index.js](../../../server/tools/index.js) 注册 | 明确 `effect`/`idempotency`/错误码；涉及写文件的工具同步检查 [artifactRegistration.js](../../../server/agent-system/artifactRegistration.js) |
| 给 Agent 增加结构化参数输入向导 | 在 `agent-config/quick-tasks/` 添加 YAML 并绑定到 Agent 的 `quickTasks` | 遵循 [任务向导配置](../../agent-wizard.md) 限制（单 Agent 最多 12 个） |
| 验证改动前后真实端到端表现 | 使用 [evals/agent](../../../evals/agent/README.md) 走与工作台相同的 `agent-runs` 运行时跑用例 | 结合 `snapshot` 接口检查工具调用、证据与产物是否符合预期 |

---

**上一篇**：[← Agent 运行时与任务调度](agent-runtime.md) ｜ **下一篇**：[文档解析、产物与数据存储 →](data-and-documents.md)

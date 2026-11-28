# CoreGenie 软件架构总览

> **文档定位（L1 总览层）**：面向有开发经验的工程师，用 5 分钟说明 CoreGenie 的系统边界、运行进程、核心链路与配置分层。各子系统的实现细节按视角拆分为四篇专题文档，可按需深入。

CoreGenie 基于 AnythingLLM 深度改造，定位是支持 3GPP 提案处理与通用知识工作的中文 Agent 工作台。工程上采用 **pnpm workspace** 管理多包（`frontend`、`server`、`collector`、`packages/contracts`），外加独立 Python 沙箱目录 `sandbox/`（由 `uv` 管理）。它的核心复杂度来自三件事：**可中断与可恢复的长耗时 Agent 任务**、**与主服务隔离的代码执行沙箱**，以及**以 Git 仓库为唯一来源的配置/Skill 体系**。

## 1. 系统由哪些运行单元组成

![CoreGenie 系统上下文与进程拓扑：浏览器前端连接单进程 Node.js 主服务（内置 @coregenie/collector），主服务协调 PostgreSQL、文件卷与向量库、沙箱 Broker 与一次性 Runner 容器，以及外部模型和 3GPP 官方站点。](diagrams/workbench.svg)

在完整部署下，系统包含四个主要运行边界：

| 运行单元 | 来源与改造 | 技术栈与位置 | 承担职责 | 通信与边界 |
| --- | --- | --- | --- | --- |
| **React 工作台（含本地工具）** | **继承并深度改造**（自研中文工作台、Agent 进度/产物界面、类型化 `apiClient`、管理后台与纯浏览器本地工具；测试用 Vitest 5） | React + Vite + TypeScript，[frontend/](../../frontend/src) · 共享契约 [packages/contracts/](../../packages/contracts) | 工作区对话、Agent 进度与产物展示、管理后台；内置纯浏览器端本地工具（如提案编号回填），处理本地文档不上传正文 | HTTP / SSE 调用 `/api/*`；生产环境由主服务托管静态资源 |
| **Node.js 主服务端（含进程内 Collector）** | **继承并深度改造**（自研 `agent-system/`、`agent-skills/`、`tools/`、`config-sync/`、`services/` 与 IDaaS 登录；已移除旧 `aibitat` 框架并将 Collector 合并为进程内包） | Express + Prisma + LangChain/LangGraph，[server/](../../server/index.js) · 进程内解析 [collector/service.js](../../collector/service.js) | 鉴权与权限控制、工作区/会话 API、Agent 调度与运行、进程内通用文档解析（`@coregenie/collector`）、对外 Developer API、配置同步 | 监听 HTTP（默认 3001），单进程常驻 `AgentRunSupervisor` 与 `config-sync` |
| **代码执行沙箱（Broker + Runner）** | **CoreGenie 自研**（基于 Docker 的三层权限隔离执行层，由 `uv` 管理依赖） | 纯标准库 Python Broker + 一次性 Docker Runner，[sandbox/](../../sandbox/README.md) | 隔离执行 `bash`、`python` 和专用转换脚本（如 3GPP DOCX→Markdown、PPT 渲染） | 主服务经 **Unix Socket + Token** 调用 Broker；**仅 Broker 持有 Docker Socket**，每次调用拉起独立受限容器 |
| **持久化与外部依赖** | **收敛与扩展**（收敛为单一 PostgreSQL Schema、PG 检查点、LanceDB/pgvector 向量库与 OpenAI/兼容模型网关；单测用嵌入式 PGlite） | PostgreSQL、`STORAGE_DIR` 文件卷、LanceDB / pgvector、OpenAI 兼容 LLM、3GPP 官网 | 业务数据、Agent 运行事件与图检查点、工作区文件与向量索引 | Prisma 管理单一 PostgreSQL；Checkpointer 写入独立 PG Schema；代理与 CA 在服务端与沙箱侧分别配置 |

## 2. 核心业务链路与真实路由

系统按**调用方、执行时长与文档保真度**区分以下主链路：

| 链路 | 典型入口 | 执行模式 | 说明与排障切入点 |
| --- | --- | --- | --- |
| **Web 工作台对话（全走异步 Agent）** | 前端先发 `POST .../stream-chat`（[chat.js](../../server/endpoints/chat.js)）→ `grepAgents()` 切换至 `GET /api/agent-runs/:runId/events` | 握手建单 → 后台调度执行 → 独立 SSE 推送与断点续传 | 因内置不可删除的默认通用 Agent，工作台正常对话**几乎全部走异步 Agent 运行时**；简单问答由 Agent 内部直接完成，复杂任务拆计划并调用工具/沙箱。API 与评测可直连 `POST .../agent-runs` |
| **对外 Developer API（含 OpenAI 兼容）** | `/api/v1/*`（[api/index.js](../../server/endpoints/api/index.js)），含 `/api/v1/openai/chat/completions` 与 `/api/v1/workspace/:slug/chat` | API Key 鉴权；管理/评测接口或同步流式 RAG 问答 | 供 `evals/agent` 自动化评测、批处理脚本及第三方 OpenAI 客户端直接调用知识库；与工作台链路隔离 |
| **文档处理与本地工具** | 进程内 `@coregenie/collector` / 沙箱转换脚本 / 浏览器 `LocalTools` | 通用纯文本抽取 / 保留原文件沙箱转换 / 纯浏览器改写 | 知识库入库走 `@coregenie/collector` 抽纯文本；3GPP 提案转换须保留图片、修订与嵌入对象，改走沙箱脚本；提案编号回填直接在浏览器内存完成 |

> **排障第一原则**：排查工作台聊天问题直接顺着 `agent-runs` 和 `agent_run_events` 查，不要误改对外同步 RAG 路径；看到“文档解析丢图或丢修订”先确认走的是 `@coregenie/collector` 通用解析还是沙箱专用脚本。

## 3. 配置与能力四层模型

为了避免提示词、工具权限和领域方法散落在数据库与代码里，CoreGenie 将 Agent 能力分为四层，且**全局配置以 [agent-config/](../../agent-config/README.md) 为唯一维护来源**：

```text
agent-config/（全局 Prompt · Agent YAML · Skill 包 · 快捷任务）
   │  启动种子写入（seed.js）或双向文件同步（config-sync）
   ▼
Agent 定义（PredefinedAgent） ── 指定 runtimeKey、允许的工具集、绑定的 Skill 与快捷任务
   │
   ├─► Runtime（执行引擎）  ── governed-agent（默认） / default-react / evidence-research
   ├─► Skill（领域方法包）  ── 全局 / 工作区私有 / 个人三级来源；按「绑定 → 激活 → 执行」生效
   └─► Tool（原子执行能力） ── 统一描述副作用、幂等性、重试与输出上限；脚本类工具进沙箱执行
```

## 4. 按视角深入阅读（L2 专题文档）

总览之外，架构实现按四个互补视角拆分。根据你当前的开发或排障目标直接进入对应文档：

| 专题文档 | 对应视角 | 核心解答的问题 |
| --- | --- | --- |
| [Agent 运行时与任务调度](architecture/agent-runtime.md) | 进程与执行视图 | 一次任务如何从 `stream-chat` / `agent-runs` 入队、抢占租约、分步调度、通过 SSE 断线补发、以及服务重启后如何从检查点恢复？LLM / LangChain / LangGraph / CoreGenie 各自管什么？ |
| [配置体系、Skill、工具与沙箱](architecture/config-skills-sandbox.md) | 开发与扩展视图 | `agent-config/` 为什么分种子与同步两种模式？前台/隐藏/停用几类预置助手除提示词外还有哪 5 项实质差异？Skill 三阶段、工具约束与沙箱隔离如何工作？ |
| [文档解析、产物与数据存储](architecture/data-and-documents.md) | 数据与文档流视图 | 进程内 `@coregenie/collector` 与沙箱转换的分界在哪？以「3GPP 提案转 Markdown」为例，附件如何进入沙箱、产出如何登记为可下载产物？PostgreSQL、检查点、文件卷与向量库各存什么？ |
| [部署拓扑、认证与网络边界](architecture/deployment-and-boundaries.md) | 部署与运行视图 | 容器如何编排？本地账号与华为 IDaaS OAuth 如何隔离？企业代理、私有 CA 和离线部署为什么要求服务端与沙箱分别配置？ |

## 5. 工程参考与延伸资料（L3）

涉及具体参数表、迁移命令或运维步骤时，直接查阅仓库内的专项文档：

- **配置与同步**：[agent-config/README.md](../../agent-config/README.md) · [仓库配置同步说明](../agent-config-sync.md) · [任务向导配置](../agent-wizard.md)
- **沙箱与执行限制**：[sandbox/README.md](../../sandbox/README.md) · [执行上限与并发配置](../execution-limits.md)
- **部署与迁移**：[本地与远端部署隔离](../deployment-profiles.md) · [历史 SQLite 到 PostgreSQL 迁移参考](../postgresql-migration.md) · [离线部署说明](../offline-deployment.md) · [前端轻量镜像](../frontend-images.md)
- **回归评测**：[Agent 评测套件说明](../../evals/agent/README.md)

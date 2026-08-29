# 3GPP 智能研究工作台

这是一个基于 [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) 改造的中文工作台，主要用于分析 3GPP 提案和会议材料，也可以处理日常问答、写作和文件分析。

产品界面仅支持简体中文。

## 当前助手

| 助手 | 适合处理 |
| --- | --- |
| 通用助手 | 日常问答、写作、内容整理、文档摘要和一般分析 |
| 3GPP 提案分析助手（Skill） | 分析一次会议、一个 KI 或一组 TDoc，比较提案、流程和公司观点 |
| 3GPP 提案转 Markdown 助手 | 上传 DOCX 或提供 TDoc 信息，生成 Markdown、原图和嵌入对象压缩包 |

“3GPP 提案分析助手（Skill）”已经取代旧版 3GPP 提案助手。项目不会同时保留两套用途相同的助手。

## 可以做什么

- 上传 PDF、Word、Excel、文本等文件，在工作区中提问和检索。
- 把 3GPP 提案 DOCX 转成 Markdown，并将图片和无法直接转换的嵌入对象一起打包。
- 按会议、KI、议程项、公司或 TDoc 编号查找并比较 3GPP 提案。
- 分析提案中的网络功能、接口、信息元素、信令步骤和流程图。
- 区分公司提案、共同署名文本、会议处理状态和已经形成的结论。
- 生成中文 Markdown 报告，并把结果保存到当前工作区。
- 配置不同的模型、向量数据库、文档解析方式和 Agent 工具。

## 第一次使用

1. 完成初始设置，配置聊天模型和嵌入模型。
2. 创建或选择一个工作区。需要分析本地资料时，先把文件上传到工作区。
3. 从输入框上方选择助手。拿不准时，可以打开侧边栏中的“帮助与示例”。
4. 写清任务范围，再发送问题。3GPP 任务最好包含工作组、会议号、KI/WI、公司、TDoc 编号和时间范围。
5. 查看助手列出的资料、缺失信息和结果。分析助手会保存报告；转换助手会生成可下载的 ZIP。

帮助页提供了每个助手的用途、所需信息和可直接填写的示例。示例只会放入输入框，不会自动发送。

## 提问示例

### 分析一次会议或一组提案

```text
分析 SA2#175 KI#22 中 S2-2606085、S2-2606481、S2-2605964、
S2-2605867、S2-2606356，比较各公司的架构路线、关键流程和未决问题。
```

### 查找某家公司的相关提案

```text
查找 SA2#175 KI#22 中华为提交或参与署名的提案，
总结各个 Solution/Variant、关键流程、会议处理状态和仍需确认的问题。
```

### 把提案转成 Markdown

```text
请下载 S2-2606085，并转换成 Markdown 和图片压缩包。
```

也可以先选择“3GPP 提案转 Markdown 助手”，再上传 `.docx` 提案。转换结果不会把图片改写成 Mermaid，也不会自动分析提案观点。

### 处理普通文档

```text
总结我上传的两份文档，列出主要结论、差异和还需要确认的信息。
```

## 使用时请注意

- 公司提交的提案不等于 3GPP 已经采纳。是否通过要看会议结果和正式材料。
- 涉及最新会议、文档版本或当前状态时，应重新查看 3GPP 官方资料。
- 流程图看不清、文档缺失或资料不完整时，助手应直接说明，不应猜测。
- 自动生成的报告仍需由熟悉相关议题的人检查，尤其是会议状态和最终结论。

本项目是研究辅助工具，与 3GPP 没有隶属或授权关系。

## 本地开发

### 环境要求

- Node.js 24.x（根目录 `package.json` 要求 `>=24 <25`）
- Yarn
- Git

如果要运行 3GPP 文档处理脚本，还需要 Python 3，以及 `lxml` 和 `openpyxl`。

### 初始化

在仓库根目录运行：

```bash
yarn setup
```

该命令会安装 `server`、`collector` 和 `frontend` 的依赖，复制环境变量示例，生成 Prisma 客户端并初始化数据库。

首次运行前请检查以下文件：

- `server/.env.development`
- `collector/.env`
- `frontend/.env`

### 启动

同时启动三个开发服务：

```bash
yarn dev
```

也可以分别启动，方便查看日志：

```bash
yarn dev:server
yarn dev:collector
yarn dev:frontend
```

默认地址：

- 前端：`http://localhost:3000`
- 服务端：`http://localhost:3001`
- 文档采集服务：默认使用端口 `8888`

## Docker

先准备配置文件，再从当前代码构建镜像：

```bash
cp -n docker/.env.example docker/.env
docker compose -f docker/docker-compose.yml up -d --build
```

启动后访问 `http://localhost:3001`。数据默认保存在 `server/storage/`，文档处理中间文件位于 `collector/hotdir/` 和 `collector/outputs/`。

如果容器需要访问宿主机上的 Ollama、LM Studio 或其他服务，请使用 `host.docker.internal`，不要在容器配置中写 `localhost`。更多说明见 [Docker 使用说明](./docker/HOW_TO_USE_DOCKER.md)。

## 常用检查命令

```bash
# 检查整个项目
yarn lint:ci

# 检查并构建前端
cd frontend
yarn lint:check
yarn build

# 检查服务端
cd server
yarn lint:check

# 运行指定测试
npx jest path/to/test.js --runInBand
```

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `frontend/` | React + Vite 前端、帮助页和简体中文文案 |
| `server/` | Node.js 服务端、Prisma 数据层、Agent 运行时和测试 |
| `server/agent-system/` | Agent 调度、任务执行和工具调用 |
| `server/agent-skills/` | 内置 3GPP Skill、脚本、种子数据和参考资料 |
| `collector/` | 文档采集、解析和转换服务 |
| `docker/` | Docker 构建与运行配置 |

开发约定见 [AGENTS.md](./AGENTS.md)。

## 上游项目与许可

本项目基于 Mintplex Labs 的 [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) 开发，并保留其原有的模型接入、文档管理、多用户、向量数据库和 Agent 能力。

项目使用 [MIT License](./LICENSE)。AnythingLLM 及相关名称归原项目所有。

# 从 SQLite 切换到 PostgreSQL

项目默认仍使用 SQLite。PostgreSQL 使用单独的 Prisma migration，避免现有实例在准备阶段受到影响。完成下面的检查和数据迁移后，再切换应用。

## 使用时请注意

- 切换前停止 AnythingLLM 服务，确保 SQLite 不再有新写入。
- 保留 `server/storage/anythingllm.db` 的只读备份，确认 PostgreSQL 稳定后再决定是否清理。
- 数据迁移命令只接受空的 PostgreSQL 业务表。目标库已有数据时会直接停止，不会覆盖。
- PostgreSQL 不接受文本中的 NUL 字节。迁移时会移除这些字节并报告数量，其他文本内容保持不变。
- LangGraph checkpoint 不从 SQLite 自动复制。切换前应让正在运行或等待恢复的 Agent 任务结束；旧 checkpoint 文件仍保留在 `server/storage/`。
- PostgreSQL 只替代关系数据库和 Agent checkpoint。向量数据库、上传文件和 collector 输出仍使用原来的配置和目录。

## Docker 测试环境

复制环境变量示例并填写下面这些值：

```dotenv
POSTGRES_DB='anythingllm'
POSTGRES_USER='anythingllm'
POSTGRES_PASSWORD='请换成强密码'
DATABASE_URL='postgresql://anythingllm:URL编码后的密码@postgres:5432/anythingllm'
POSTGRES_MIGRATION_URL='postgresql://anythingllm:URL编码后的密码@localhost:5432/anythingllm'
```

密码包含 `@`、`:`、`/` 等字符时，必须在两个 URL 中进行 URL 编码。`POSTGRES_PASSWORD` 仍填写原始密码。

从项目根目录启动 PostgreSQL 服务：

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.postgresql.yml up -d postgres
```

首次启动只创建空库，不要先启动 AnythingLLM。检查 migration 和数据迁移计划：

```bash
set -a
source docker/.env
set +a
DATABASE_URL="$POSTGRES_MIGRATION_URL" yarn prisma:postgres:prepare
DATABASE_URL="$POSTGRES_MIGRATION_URL" yarn prisma:postgres:migrate
DATABASE_URL="$POSTGRES_MIGRATION_URL" yarn prisma:postgres:transfer
```

最后一个命令默认只检查 SQLite 完整性、目标库是否为空、表结构和各表行数。检查通过后，停止当前 AnythingLLM，再执行复制：

```bash
DATABASE_URL="$POSTGRES_MIGRATION_URL" yarn prisma:postgres:transfer --execute
```

`DATABASE_URL` 供容器连接 `postgres`，`POSTGRES_MIGRATION_URL` 供宿主机通过本机端口执行迁移。不要把生产密码写入命令历史或提交到仓库。

数据复制完成后启动整套服务：

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.postgresql.yml up -d
```

容器启动时会补齐系统默认设置和反馈原因。内置 3GPP Agent 与 Skill 仍按现有逻辑在第一次使用 Agent 时写入。

## 非 Docker 部署

设置以下变量后使用 PostgreSQL 命令：

```dotenv
DATABASE_PROVIDER='postgresql'
DATABASE_URL='postgresql://user:password@host:5432/anythingllm'
LANGGRAPH_CHECKPOINT_BACKEND='postgresql'
```

新安装可以一次完成 Prisma Client、migration 和初始数据设置：

```bash
yarn prisma:postgres:setup
```

已有 SQLite 数据时仍按前面的顺序操作，先部署 migration 和复制数据，最后再启动应用。

非 Docker 启动脚本需要在执行 `node server/index.js` 前运行 `yarn prisma:postgres:generate`。生成的 Client 决定当前进程连接 SQLite 还是 PostgreSQL。

LangGraph 默认复用 `DATABASE_URL`，分别使用 `langgraph` 和 `langgraph_custom` schema。需要独立数据库或自定义 schema 时设置：

```dotenv
LANGGRAPH_CHECKPOINT_DATABASE_URL='postgresql://user:password@host:5432/checkpoints'
LANGGRAPH_CHECKPOINT_SCHEMA='langgraph'
LANGGRAPH_CUSTOM_CHECKPOINT_SCHEMA='langgraph_custom'
```

数据库用户需要创建 schema 和表的权限。LangGraph 第一次使用时会自动创建相关表。

## 切换后检查

至少完成这些检查：

1. 登录并打开已有 Workspace、Thread 和聊天记录。
2. 新建一条聊天并刷新页面，确认内容仍存在。
3. 上传一份测试文档并完成向量检索。
4. 执行一个 Agent，确认运行记录、工具记录和最终结果可以查看。
5. 执行一个允许恢复或需要确认的 Agent，确认 checkpoint 正常工作。
6. 检查定时任务列表和一次手动运行结果。
7. 观察 PostgreSQL 连接数、慢查询和磁盘增长。

确认没有问题前，不要删除 SQLite 数据库和 `langgraph-*.db` 文件。回滚时停止应用，恢复 SQLite 模式，重新运行 `yarn prisma:generate`，再启动服务。

# 离线部署包

离线部署包适合把当前安装迁移到一台没有外网的 Linux 服务器。它包含当前 AnythingLLM 应用镜像、PostgreSQL 17 镜像、Sandbox 镜像和一个只保留全局数据的数据包。Workspace 的数据库记录、Workspace 文档、聊天记录、Workspace 向量和 Workspace 文件不会进入数据包。

数据包会保留：

- 用户、API Key、系统设置和全局提示词变量；
- Agent、Skill、Quick Task、模型能力和模型路由配置；
- 全局记忆、全局定时任务、全局连接器、快捷命令和全局参考资料；
- `global_documents` 及其解析后的源文件；
- 全局知识库和全局 RAG Memory 的向量数据（见下文“目标服务器 CPU 不支持 AVX 时”）。
- 全局 Skill 包、Agent 图标、插件配置、模型缓存和其他全局运行文件。

包里还带有源站的 `.env`（模型服务地址、API Key、JWT 密钥）和 `agent-config/` 目录（提示词、Agent、Skill 的文件配置）。安装时 `.env` 会写入目标机的数据目录，`agent-config/` 会以仓库同步的方式挂载进容器。

Promptfoo 评测界面不在离线包里。需要评测时在目标机另行准备镜像并设置 `PROMPTFOO_ENABLED=true`。

离线包默认按源站相同的方式使用 LanceDB（`VECTOR_DB=lancedb`），两个全局命名空间直接复制文件迁移。外部向量服务（Qdrant、Pinecone、Milvus）不能通过复制文件离线迁移，需要单独处理。

### 目标服务器 CPU 不支持 AVX 时

LanceDB 的原生库和 Milvus 的检索库都要求 CPU 支持 AVX 指令集，在不支持 AVX 的机器上会直接崩溃（退出码 132）。部分云服务器的虚拟化不透传 AVX，即使物理 CPU 支持也不可用。此时改用 Qdrant：

1. 在目标服务器运行 Qdrant 容器：

   ```bash
   docker run -d --name anythingllm-qdrant --restart unless-stopped \
     --network anythingllm-db \
     -v anythingllm_qdrant:/qdrant/storage \
     -p 6333:6333 qdrant/qdrant:latest
   ```

2. 在数据目录的 `.env` 中设置 `VECTOR_DB='qdrant'` 和 `QDRANT_ENDPOINT='http://anythingllm-qdrant:6333'`。

3. 从源站导出全局向量，再导入 Qdrant。在源站仓库的 server 目录运行：

   ```bash
   STORAGE_DIR=/path/to/source/storage \
   node scripts/offline/export-global-vectors.js --output /tmp/global-vectors.json
   ```

   导出 JSON 的结构是 `{ "<命名空间>": { present, rows: [{ id, ...元数据, text, vector }] } }`。把文件复制进目标机的应用容器后，在容器内运行：

   ```bash
   docker cp /tmp/global-vectors.json <应用容器>:/tmp/global-vectors.json
   docker exec -w /app/server -e QDRANT_ENDPOINT=http://anythingllm-qdrant:6333 \
     <应用容器> node scripts/offline/import-global-vectors-qdrant.js \
     --input /tmp/global-vectors.json
   ```

   注意：应用镜像里需要包含这两个脚本；镜像早于脚本存在时，用 `docker cp` 把脚本也复制进容器。集合格式（point id、payload、Cosine 距离）由 `server/utils/vectorDbProviders/qdrant` 定义，导入脚本与其保持一致。

## 生成数据包

停止源站 AnythingLLM，避免导出时仍有数据库或向量写入。确认源站已经配置好 PostgreSQL 环境变量，然后在仓库根目录执行：

```bash
DATABASE_PROVIDER=postgresql \
DATABASE_URL='postgresql://user:password@host:5432/anythingllm' \
VECTOR_DB=lancedb \
scripts/create-offline-package.sh \
  --output ./offline-package \
  --archive ./anythingllm-offline.tar.gz \
  --storage-root /path/to/source/storage
```

生成脚本会保存四类镜像 tar：应用镜像、`postgres:17-alpine`、Sandbox runner 和 Sandbox broker。目标服务器不需要执行 Docker build，也不需要访问镜像仓库。

应用镜像必须包含 `server/scripts/offline/global-data.js`（导入步骤在镜像内执行）。生成脚本会检查这一点，发现旧镜像时会自动重新构建；加 `--skip-build` 时遇到旧镜像会直接报错。不需要 Sandbox 时加 `--skip-sandbox`，可以少打包两个镜像。

如果源站当前使用 SQLite，先完成 PostgreSQL 切换，再生成离线包。现有切换步骤见 [PostgreSQL 迁移说明](./postgresql-migration.md)。

## 在目标服务器安装

把 `anythingllm-offline.tar.gz` 复制到目标服务器。目标服务器只需要 Docker，解包并执行：

```bash
tar -xzf anythingllm-offline.tar.gz
./anythingllm-offline-package/install-offline-package.sh ./anythingllm-offline-package
```

安装脚本会：

1. 加载应用、PostgreSQL 和 Sandbox 镜像；
2. 把包内的 `.env` 写入数据目录（仅在目标机还没有 `.env` 时）；
3. 创建一个新的 PostgreSQL 数据库；
4. 部署 Prisma migration；
5. 导入全局数据库记录、全局文件和全局向量数据；
6. 启动 Sandbox broker 和 AnythingLLM。

默认数据目录是 `$HOME/anythingllm`，端口是 `7555`。可以在执行前设置 `STORAGE_LOCATION`、`HOST_PORT`、`POSTGRES_PASSWORD`、`CONTAINER_NAME` 等环境变量。

### Sandbox 代理

Sandbox runner 默认走 `http://host.docker.internal:7890` 代理。目标机代理地址不同时，安装前设置：

```bash
SANDBOX_PROXY=http://172.17.0.1:7890 \
./anythingllm-offline-package/install-offline-package.sh ./anythingllm-offline-package
```

设置 `SANDBOX_PROXY=""` 可以禁用 runner 代理。代理只作用于 Sandbox 内执行的代码；应用容器本身的代理用 `ANYTHINGLLM_PROXY` 控制，同样在安装前设置。

## 安全和检查

数据包包含用户密码哈希、API Key、连接器配置和源站 `.env` 里的密钥。传输和保存时请按密钥材料处理，不要提交到 Git。脚本会为数据包内的每个文件写入 SHA-256 校验值，导入前会验证这些值。

导入完成后，应检查：

1. 管理员可以登录，系统设置和 Agent 配置仍在；
2. 全局知识库列表完整；
3. 对全局知识库和全局 RAG Memory 的检索可以返回原有内容；
4. 新建一个空 Workspace 后，可以使用全局知识库；
5. 目标机没有旧 Workspace、Workspace 聊天或 Workspace 文件。

导入脚本要求目标数据库是空的业务库，并且使用 PostgreSQL。目标数据已经存在时，脚本会停止；只有确认要合并时才使用 `--allow-existing`。重复启动不会重复导入，因为数据目录中会写入 `.offline-global-data-imported.json` 标记。

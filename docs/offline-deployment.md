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

默认数据目录是 `$HOME/anythingllm`，端口是 `80`。可以在执行前设置 `STORAGE_LOCATION`、`HOST_PORT`、`POSTGRES_PASSWORD`、`CONTAINER_NAME` 等环境变量。

### Sandbox 代理

Sandbox runner 默认走 `http://host.docker.internal:7890` 代理。目标机代理地址不同时，安装前设置：

```bash
SANDBOX_PROXY=http://172.17.0.1:7890 \
./anythingllm-offline-package/install-offline-package.sh ./anythingllm-offline-package
```

设置 `SANDBOX_PROXY=""` 可以禁用 runner 代理。代理只作用于 Sandbox 内执行的代码；应用容器本身的代理用 `ANYTHINGLLM_PROXY` 控制，同样在安装前设置。

代理对 HTTPS 做透明 MITM（如 SWG）时，runner 镜像还需要信任代理的根证书，否则容器内所有 https 请求都会证书校验失败。在目标机上给 runner 镜像追加一层 CA：

```bash
cd /root/CoreGenie  # 需要 swg-ca/ 目录（从宿主机 /usr/local/share/ca-certificates/ 复制）
cat > /tmp/Dockerfile.sandbox-ca <<'EOF'
FROM anythingllm-sandbox:local
USER root
COPY swg-ca/ /usr/local/share/ca-certificates/
RUN update-ca-certificates
USER sandbox:sandbox
EOF
docker build -t anythingllm-sandbox:local -f /tmp/Dockerfile.sandbox-ca .
```

注意保持镜像的 `USER`（`sandbox:sandbox`）和 CMD（`python3 -I -B -`）不变；不要用 `docker commit` 固化临时容器的 ENTRYPOINT，会破坏 broker 启动 runner 的方式。broker 的 `--proxy-url` 已经把代理传给 runner 的环境变量。

## 通过 GitHub 镜像更新

代码推送到 GitHub 后，`build-and-push-image.yaml` 会构建应用镜像并发布到 `ghcr.io/acore2026/coregenie`（`latest` 和 `master` 两个标签）。目标机不需要重新执行离线安装，直接拉取新镜像重建容器：

```bash
STORAGE_LOCATION=/root/anythingllm \
AGENT_CONFIG_SYNC_DIR=/root/offline-extract/agent-config \
bash pull-and-update-from-ghcr.sh
```

脚本（`scripts/pull-and-update-from-ghcr.sh`）会拉取镜像、删除旧容器、按原配置重建并等待健康检查通过。数据目录、`.env`、agent-config 挂载和数据库都不变。

注意事项：

1. 镜像是多架构的（amd64/arm64），目标机会自动拉取对应架构。
2. `agent-config/` 不在镜像里，仓库中该目录有更新时需要单独同步到目标机的挂载目录。
3. 该 workflow 也支持在 GitHub 页面手动触发（workflow_dispatch），适合不改代码重建镜像的场景。
4. 目标机出网需要走认证代理时，脚本默认给应用容器配置 `PROXY`（默认 `http://172.17.0.1:3128`，即宿主机 cntlm 经 docker0 网关）。代理对 HTTPS 做透明 MITM 时，脚本同时挂载宿主机 CA bundle 并设置 `NODE_EXTRA_CA_CERTS`。内网地址（模型端点、数据库、向量库）走 `NO_PROXY` 直连。
5. 使用 cntlm 且 Docker 容器需要经它出网时，`/etc/cntlm.conf` 的 `Allow` 列表需要包含容器网段（如 `172.17.0.0/16`、`172.18.0.0/16`），否则返回 407。

## 在目标服务器直接构建镜像

目标机能访问 GitHub 但不便使用 GHCR 镜像时，可以直接 clone 仓库构建。`/root/build-local-from-github.sh`（目标机）封装了完整流程，处理了三类网络差异：

1. 构建容器需要信任 MITM 代理的根证书：先构建预置宿主机 SWG CA 的 base 镜像（`ubuntu-swg-base:noble`、`node-swg:24-slim`），并设置 `NODE_EXTRA_CA_CERTS`。
2. `docker build --network=host` 让 RUN 步骤使用宿主网络栈，代理用 `127.0.0.1:3128`；Ubuntu 源覆盖为 `archive.ubuntu.com`（默认的 aliyun 源在该网络不可达）。
3. `server/yarn.lock` 中指向 `repo.huaweicloud.com` 的 `resolved` 条目在该网络不可达，构建时替换为 npmmirror；`require('@lancedb/lancedb')` 的构建自检在无 AVX 的机器上会 SIGILL，构建时移除（运行时使用 Qdrant，不需要该库）。

```bash
bash /root/build-local-from-github.sh          # 默认 master
bash /root/build-local-from-github.sh v1.15.0  # 指定分支或标签
```

SWG 对 npm CDN 限速明显，冷构建约 30–40 分钟（依赖层有缓存后只需 3–5 分钟）。构建完成后按脚本末尾打印的 `docker run` 命令重建应用容器，或使用上文带代理配置的 `pull-and-update-from-ghcr.sh`（把 `IMAGE` 换成本地标签）。

## 安全和检查

数据包包含用户密码哈希、API Key、连接器配置和源站 `.env` 里的密钥。传输和保存时请按密钥材料处理，不要提交到 Git。脚本会为数据包内的每个文件写入 SHA-256 校验值，导入前会验证这些值。

导入完成后，应检查：

1. 管理员可以登录，系统设置和 Agent 配置仍在；
2. 全局知识库列表完整；
3. 对全局知识库和全局 RAG Memory 的检索可以返回原有内容；
4. 新建一个空 Workspace 后，可以使用全局知识库；
5. 目标机没有旧 Workspace、Workspace 聊天或 Workspace 文件。

导入脚本要求目标数据库是空的业务库，并且使用 PostgreSQL。目标数据已经存在时，脚本会停止；只有确认要合并时才使用 `--allow-existing`。重复启动不会重复导入，因为数据目录中会写入 `.offline-global-data-imported.json` 标记。

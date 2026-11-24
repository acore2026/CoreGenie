# 本地与远端部署隔离

同一份代码用于两种部署。只同步代码和前端产物，不复制远端数据库、账号、密钥或 `.env`。

| 配置 | 本地安装 | 华为 IDaaS 安装 |
| --- | --- | --- |
| `COREGENIE_AUTH_MODE` | `local`（不设置也使用本地认证） | `idaas` |
| `COREGENIE_IDAAS_CONFIG_FILE` | 不需要 | 指向该安装自己的 JSON 密钥文件 |
| 账号、注册、原有 SSO | 保持现有配置 | 关闭本地登录，走 IDaaS |
| 宿主机端口 | 保持现有映射；Compose 可用 `APP_PORT` | 独立设置，必须与 IDaaS 注册端口一致 |
| 数据库、向量库、模型地址 | 保持本地配置 | 保持远端配置 |
| 代理、额外 CA | 按本地网络配置 | 需要 SWG 时显式配置 |

`COREGENIE_AUTH_MODE=local` 不会读取 IDaaS 密钥文件，也不把本地用户转成 OAuth 用户。OAuth 相关数据库迁移只新增可空字段和会话表，不修改现有用户或内容。

需要代理时才配置 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 和 `NODE_USE_ENV_PROXY=1`；需要私有 CA 时才挂载证书并设置 `NODE_EXTRA_CA_CERTS`。不要直接复制另一台机器的网络参数。

本地代理访问 3GPP 出现 `ECONNRESET`、但直连已验证可用时，可在下方部署命令追加 `--no-proxy-append '3gpp.org,.3gpp.org'`。脚本合并已有 `NO_PROXY`、`no_proxy` 并同时追加域名，不更换代理地址；默认不追加。此例不适用于必须经 SWG 出网的远端环境。

## 下载镜像部署（v1.15.1）

镜像：`ghcr.io/acore2026/coregenie:1.15.1`，支持 amd64 和 arm64。无需拉取源码或本地构建。先下载脚本：

```bash
curl -fL --retry 3 -o deploy-image.sh \
  https://github.com/acore2026/CoreGenie/releases/download/v1.15.1/deploy-image.sh
```

### 更新已有安装

在 Docker 宿主机执行，需要 Docker 和 Node.js 18+，使用默认本地 Docker socket：

```bash
CONTAINER_NAME=anythingllm bash deploy-image.sh update
```

脚本自动下载同版本更新工具，拉取镜像后才停止旧容器。保留挂载、网络、代理、端口、启动命令、认证方式和数据目录。默认拒绝中断正在运行或排队的 Agent 任务。健康检查失败会恢复旧容器。

**不备份数据库或文件。** 更新工具只保存权限为 600 的容器配置和部署记录，默认放在宿主机临时目录，可用 `STATE_DIR=/absolute/private/directory` 指定新的空目录。记录含环境变量，请按私密配置保管。旧容器保留为 `anythingllm-before-时间戳`；容器恢复不会回滚数据库迁移。

### 首次安装

```bash
bash deploy-image.sh install
```

默认端口为 7555，数据保存在 `anythingllm-storage` Docker 卷，`.env` 保存在当前目录的 `coregenie-config/`。容器内默认用户 UID 为 1000，需要能读写配置文件。可通过 `HOST_PORT`、`STORAGE_VOLUME`、`CONFIG_DIR` 调整，或用 `ENV_FILE=/absolute/path/coregenie.env` 指定现有配置文件。

此入口安装 SQLite 基础版，不安装代码执行沙箱。已有安装更新时保留原 PostgreSQL、沙箱和其他服务连接配置。

### 首次安装并启用 OAuth

镜像包含华为 IDaaS OAuth 功能，密钥由每个安装自行提供：

```bash
IDAAS_CONFIG_FILE=/absolute/path/idaas.json bash deploy-image.sh install
```

脚本以只读方式挂载该文件，并设置 `COREGENIE_AUTH_MODE=idaas` 和容器内 `COREGENIE_IDAAS_CONFIG_FILE`。JSON 文件需要以下字段（示例值须替换）：

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "environment": "production",
  "redirectUri": "https://your-host/api/auth/idaas/callback"
}
```

`environment` 支持 `production` 和 `beta`。回调地址须与 IDaaS 客户端注册配置一致，配置文件需允许容器用户 UID 1000 读取。已有 OAuth 安装直接运行 `update`，会保留原文件挂载和认证环境变量。

### 使用自行构建的镜像

```bash
node scripts/deploy-existing-container.cjs \
  --image anythingllm:your-tested-build \
  --container anythingllm
```

可显式传入 `--auth-mode local|idaas` 覆盖认证模式；只有接受中断任务时才传入 `--allow-running`。`--no-proxy-append` 适用于已确认需要直连的域名。不会自动修改代理或域名。

单独构建部署用前端时，使用 `cd frontend && VITE_API_BASE=/api yarn build`，避免开发环境 `.env` 中的 `localhost:3001` 被写入正式页面。

首次切换新认证模式前，应测试账号登录。检查 `/api/auth/config`：本地应返回 `{"provider":"local"}`。同时检查公共知识库、工作区和聊天记录仍在。

不要把远端的一次性 `reset-old-data`、账号迁移、知识库恢复脚本加入部署入口。`pull-and-update-from-ghcr.sh` 是既有远端专用脚本，带特定代理默认值，不用于保留本地配置的更新。

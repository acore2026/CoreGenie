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

## 更新已运行的本地容器

先构建候选镜像、运行相关测试，备份当前数据库和持久化目录，再执行：

```bash
node scripts/deploy-existing-container.cjs \
  --image anythingllm:your-tested-build \
  --container anythingllm \
  --auth-mode local \
  --backup-dir /absolute/private/backup-directory
```

脚本保留现有挂载、网络、代理、端口、启动命令和数据目录。只替换镜像，并在明确传入 `--auth-mode` 时覆盖认证模式。脚本不会导入数据库、重置数据、迁移账号、替换代理或自动修改域名。默认拒绝在 Agent 运行时重启；只有用户明确接受中断任务时，才传入 `--allow-running`。脚本保留旧容器，健康检查失败会恢复旧容器。数据库备份必须由操作者事先完成，脚本回退只恢复容器，不回滚数据库迁移。

单独构建部署用前端时，使用 `cd frontend && VITE_API_BASE=/api yarn build`，避免开发环境 `.env` 中的 `localhost:3001` 被写入正式页面。

首次切换新认证模式前，应测试账号登录。检查 `/api/auth/config`：本地应返回 `{"provider":"local"}`。同时检查公共知识库、工作区和聊天记录仍在。

不要把远端的一次性 `reset-old-data`、账号迁移、知识库恢复脚本加入部署入口。`pull-and-update-from-ghcr.sh` 是既有远端专用脚本，带特定代理默认值，不用于保留本地配置的更新。

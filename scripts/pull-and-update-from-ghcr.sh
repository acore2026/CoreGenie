#!/usr/bin/env bash
# 从 GHCR 拉取最新应用镜像并重建本机 AnythingLLM 容器（带出网代理配置）。
# 用法：在目标机执行 IMAGE_TAG=latest bash pull-and-update-from-ghcr.sh
# 目标机出网必须走 cntlm 代理（经 docker0 网关 172.17.0.1），可用 PROXY= 覆盖；
# 代理是透明 MITM 时需同时挂载宿主机 CA bundle（见 --volume ca-certificates.crt）。
set -Eeuo pipefail

IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="ghcr.io/acore2026/coregenie:${IMAGE_TAG}"
STORAGE_LOCATION="${STORAGE_LOCATION:-${HOME}/anythingllm}"
CONTAINER_NAME="${CONTAINER_NAME:-anythingllm}"
PROXY="${PROXY:-http://172.17.0.1:3128}"
# 内网服务直连，不走代理：模型端点、数据库、向量库和内网段。
NO_PROXY_LIST="localhost,127.0.0.1,100.100.6.226,anythingllm-postgres,anythingllm-qdrant,anythingllm-sandbox-broker,172.16.0.0/12,10.0.0.0/8,7.0.0.0/8"

echo "Pulling ${IMAGE}..."
docker pull "${IMAGE}"

echo "Recreating container '${CONTAINER_NAME}'..."
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --network anythingllm-db \
  --publish "${HOST_PORT:-7555}:3001" \
  --add-host host.docker.internal:host-gateway \
  --volume "${STORAGE_LOCATION}:/app/server/storage" \
  --volume "${STORAGE_LOCATION}/.env:/app/server/.env" \
  --volume /etc/ssl/certs/ca-certificates.crt:/etc/ssl/certs/ca-certificates-swg.crt:ro \
  --env STORAGE_DIR=/app/server/storage \
  --mount "type=bind,source=${AGENT_CONFIG_SYNC_DIR:-${HOME}/offline-extract/agent-config},target=/app/agent-config" \
  --env AGENT_CONFIG_SYNC_ENABLED=true \
  --env AGENT_CONFIG_SYNC_DIR=/app/agent-config \
  --env SANDBOX_BROKER_SOCKET=/app/server/storage/sandbox/run.sock \
  --env SANDBOX_BROKER_TOKEN_FILE=/app/server/storage/sandbox/token \
  --env "HTTP_PROXY=${PROXY}" --env "HTTPS_PROXY=${PROXY}" \
  --env "http_proxy=${PROXY}" --env "https_proxy=${PROXY}" \
  --env "NO_PROXY=${NO_PROXY_LIST}" --env "no_proxy=${NO_PROXY_LIST}" \
  --env NODE_USE_ENV_PROXY=1 \
  --env NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates-swg.crt \
  "${IMAGE}"

for _ in $(seq 1 60); do
  if curl --fail --silent --max-time 2 "http://localhost:${HOST_PORT:-7555}/api/ping" >/dev/null; then
    echo "AnythingLLM is up on ${IMAGE}"
    exit 0
  fi
  sleep 2
done
echo "Error: app did not become ready." >&2
docker logs --tail 50 "${CONTAINER_NAME}" >&2
exit 1
# 更新后建议清理旧镜像：docker image prune -f

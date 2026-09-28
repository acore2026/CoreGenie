#!/usr/bin/env bash
# 从 GHCR 拉取最新应用镜像并重建本机 AnythingLLM 容器。
# 用法：在目标机执行 IMAGE_TAG=latest bash pull-and-update-from-ghcr.sh
set -Eeuo pipefail

IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="ghcr.io/acore2026/coregenie:${IMAGE_TAG}"
STORAGE_LOCATION="${STORAGE_LOCATION:-${HOME}/anythingllm}"
CONTAINER_NAME="${CONTAINER_NAME:-anythingllm}"

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
  --env STORAGE_DIR=/app/server/storage \
  --mount "type=bind,source=${AGENT_CONFIG_SYNC_DIR:-${HOME}/offline-extract/agent-config},target=/app/agent-config" \
  --env AGENT_CONFIG_SYNC_ENABLED=true \
  --env AGENT_CONFIG_SYNC_DIR=/app/agent-config \
  --env SANDBOX_BROKER_SOCKET=/app/server/storage/sandbox/run.sock \
  --env SANDBOX_BROKER_TOKEN_FILE=/app/server/storage/sandbox/token \
  --env "NO_PROXY=localhost,127.0.0.1,100.100.6.226" \
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

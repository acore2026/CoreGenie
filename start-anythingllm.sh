#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Start a persistent AnythingLLM Docker container.

Environment overrides:
  STORAGE_LOCATION       Host data directory (default: $HOME/anythingllm)
  ANYTHINGLLM_IMAGE      Docker image (default: anythingllm:local)
  CONTAINER_NAME         Container name (default: anythingllm)
  HOST_PORT              Host HTTP port (default: 7555)
  ANYTHINGLLM_PROXY      Optional container HTTP(S) proxy URL
  ANYTHINGLLM_NO_PROXY   Container proxy bypass list
  ANYTHINGLLM_UID        Image user ID used for root-created storage (default: 1000)
  ANYTHINGLLM_GID        Image group ID used for root-created storage (default: 1000)
  APP_REBUILD            Rebuild the AnythingLLM image before start (default: false)
  APP_RECREATE           Recreate the AnythingLLM container (default: false)
  AGENT_MAX_CONCURRENCY  Maximum parallel Agent tasks (default: 6)
  SANDBOX_ENABLED        Start the disposable code sandbox (default: true)
  SANDBOX_IMAGE          Sandbox runner image (default: anythingllm-sandbox:local)
  SANDBOX_BROKER_IMAGE   Sandbox broker image (default: anythingllm-sandbox-broker:local)
  SANDBOX_REBUILD        Rebuild sandbox images and recreate broker (default: false)
  SANDBOX_MAX_CONCURRENCY Maximum simultaneous executions (default: 6)
  SANDBOX_NETWORK        Runner network: bridge or none (default: bridge)
  SANDBOX_PROXY          Runner HTTP(S) proxy (default: ANYTHINGLLM_PROXY or
                         http://host.docker.internal:7890)

Example using a locally built image:
  ANYTHINGLLM_IMAGE=anythingllm:local ./start-anythingllm.sh
EOF
  exit 0
fi

STORAGE_LOCATION="${STORAGE_LOCATION:-${HOME}/anythingllm}"
ANYTHINGLLM_IMAGE="${ANYTHINGLLM_IMAGE:-anythingllm:local}"
CONTAINER_NAME="${CONTAINER_NAME:-anythingllm}"
HOST_PORT="${HOST_PORT:-7555}"
# Langfuse's OTLP endpoint is reachable directly from this host. Bypassing the
# general-purpose proxy avoids a proxy path that can acknowledge OTLP batches
# without making them visible to the project.
ANYTHINGLLM_NO_PROXY="${ANYTHINGLLM_NO_PROXY:-localhost,127.0.0.1,::1,host.docker.internal,jp.cloud.langfuse.com}"
ANYTHINGLLM_UID="${ANYTHINGLLM_UID:-1000}"
ANYTHINGLLM_GID="${ANYTHINGLLM_GID:-1000}"
APP_REBUILD="${APP_REBUILD:-false}"
APP_RECREATE="${APP_RECREATE:-false}"
AGENT_MAX_CONCURRENCY="${AGENT_MAX_CONCURRENCY:-6}"
SANDBOX_ENABLED="${SANDBOX_ENABLED:-true}"
SANDBOX_IMAGE="${SANDBOX_IMAGE:-anythingllm-sandbox:local}"
SANDBOX_BROKER_IMAGE="${SANDBOX_BROKER_IMAGE:-anythingllm-sandbox-broker:local}"
SANDBOX_REBUILD="${SANDBOX_REBUILD:-false}"
SANDBOX_MAX_CONCURRENCY="${SANDBOX_MAX_CONCURRENCY:-6}"
SANDBOX_NETWORK="${SANDBOX_NETWORK:-bridge}"
SANDBOX_PROXY="${SANDBOX_PROXY:-${ANYTHINGLLM_PROXY:-http://host.docker.internal:7890}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

PROXY_ARGS=()
if [[ -n "${ANYTHINGLLM_PROXY:-}" ]]; then
  PROXY_ARGS+=(
    --env "HTTP_PROXY=$ANYTHINGLLM_PROXY"
    --env "HTTPS_PROXY=$ANYTHINGLLM_PROXY"
    --env "http_proxy=$ANYTHINGLLM_PROXY"
    --env "https_proxy=$ANYTHINGLLM_PROXY"
  )
fi

SANDBOX_PROXY_ARGS=()
if [[ -n "$SANDBOX_PROXY" ]]; then
  SANDBOX_PROXY_ARGS+=(--proxy-url "$SANDBOX_PROXY")
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or is not available in PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: cannot connect to the Docker daemon." >&2
  exit 1
fi

if [[ ! "$HOST_PORT" =~ ^[0-9]+$ ]] || ((HOST_PORT < 1 || HOST_PORT > 65535)); then
  echo "Error: HOST_PORT must be an integer between 1 and 65535." >&2
  exit 1
fi

if [[ ! "$ANYTHINGLLM_UID" =~ ^[0-9]+$ || ! "$ANYTHINGLLM_GID" =~ ^[0-9]+$ ]]; then
  echo "Error: ANYTHINGLLM_UID and ANYTHINGLLM_GID must be integers." >&2
  exit 1
fi

for concurrency_setting in AGENT_MAX_CONCURRENCY SANDBOX_MAX_CONCURRENCY; do
  concurrency_value="${!concurrency_setting}"
  if [[ ! "$concurrency_value" =~ ^[0-9]+$ ]] || \
    ((concurrency_value < 1 || concurrency_value > 16)); then
    echo "Error: $concurrency_setting must be an integer between 1 and 16." >&2
    exit 1
  fi
done

if [[ "$SANDBOX_NETWORK" != "bridge" && "$SANDBOX_NETWORK" != "none" ]]; then
  echo "Error: SANDBOX_NETWORK must be 'bridge' or 'none'." >&2
  exit 1
fi

if [[ "$APP_REBUILD" == "true" ]]; then
  echo "Building AnythingLLM image '$ANYTHINGLLM_IMAGE'..."
  docker build \
    --tag "$ANYTHINGLLM_IMAGE" \
    --file "$SCRIPT_DIR/docker/Dockerfile" \
    "$SCRIPT_DIR"
fi

mkdir -p -- "$STORAGE_LOCATION"
STORAGE_LOCATION="$(cd "$STORAGE_LOCATION" && pwd -P)"
touch "$STORAGE_LOCATION/.env"
mkdir -p \
  "$STORAGE_LOCATION/sandbox" \
  "$STORAGE_LOCATION/anythingllm-fs/workspaces" \
  "$STORAGE_LOCATION/agent-skills/global"

# The official image runs as UID/GID 1000. Storage created by root must be
# writable by that unprivileged container user.
if ((EUID == 0)); then
  chown "$ANYTHINGLLM_UID:$ANYTHINGLLM_GID" \
    "$STORAGE_LOCATION" \
    "$STORAGE_LOCATION/.env" \
    "$STORAGE_LOCATION/sandbox" \
    "$STORAGE_LOCATION/anythingllm-fs" \
    "$STORAGE_LOCATION/anythingllm-fs/workspaces" \
    "$STORAGE_LOCATION/agent-skills" \
    "$STORAGE_LOCATION/agent-skills/global"
fi

start_sandbox_broker() {
  local sandbox_socket="$STORAGE_LOCATION/sandbox/run.sock"
  local sandbox_broker_name="${CONTAINER_NAME}-sandbox-broker"
  local workspace_root="$STORAGE_LOCATION/anythingllm-fs/workspaces"
  local global_skills_root="$STORAGE_LOCATION/agent-skills/global"
  local docker_socket_gid
  docker_socket_gid="$(stat -c '%g' /var/run/docker.sock)"

  if [[ "$SANDBOX_REBUILD" == "true" ]] || \
    ! docker image inspect "$SANDBOX_IMAGE" >/dev/null 2>&1; then
    echo "Building sandbox runner image '$SANDBOX_IMAGE'..."
    docker build \
      --tag "$SANDBOX_IMAGE" \
      --build-arg "SANDBOX_UID=$ANYTHINGLLM_UID" \
      --build-arg "SANDBOX_GID=$ANYTHINGLLM_GID" \
      "$SCRIPT_DIR/sandbox"
  fi

  if [[ "$SANDBOX_REBUILD" == "true" ]] || \
    ! docker image inspect "$SANDBOX_BROKER_IMAGE" >/dev/null 2>&1; then
    echo "Building sandbox broker image '$SANDBOX_BROKER_IMAGE'..."
    docker build \
      --tag "$SANDBOX_BROKER_IMAGE" \
      --file "$SCRIPT_DIR/sandbox/Dockerfile.broker" \
      "$SCRIPT_DIR/sandbox"
  fi

  if [[ "$SANDBOX_REBUILD" == "true" ]] && \
    docker container inspect "$sandbox_broker_name" >/dev/null 2>&1; then
    echo "Replacing sandbox broker '$sandbox_broker_name'..."
    docker rm --force "$sandbox_broker_name" >/dev/null
  fi

  if docker container inspect "$sandbox_broker_name" >/dev/null 2>&1 && \
    ! docker inspect --format '{{json .Config.Cmd}}' "$sandbox_broker_name" | \
      grep -q -- '--global-skills-root'; then
    echo "Replacing sandbox broker to enable Agent Skill mounts..."
    docker rm --force "$sandbox_broker_name" >/dev/null
  fi

  if docker container inspect "$sandbox_broker_name" >/dev/null 2>&1 && \
    ! docker inspect --format '{{json .Config.Cmd}}' "$sandbox_broker_name" | \
      grep -Fq -- "\"--max-concurrency\",\"$SANDBOX_MAX_CONCURRENCY\""; then
    echo "Replacing sandbox broker to apply concurrency $SANDBOX_MAX_CONCURRENCY..."
    docker rm --force "$sandbox_broker_name" >/dev/null
  fi

  if docker container inspect "$sandbox_broker_name" >/dev/null 2>&1; then
    if [[ "$(docker inspect --format '{{.State.Running}}' "$sandbox_broker_name")" != "true" ]]; then
      echo "Starting existing sandbox broker '$sandbox_broker_name'..."
      docker start "$sandbox_broker_name" >/dev/null
    else
      echo "Sandbox broker container is already running."
    fi
  else
    rm -f -- "$sandbox_socket"
    echo "Creating sandbox broker container '$sandbox_broker_name'..."
    docker run -d \
      --name "$sandbox_broker_name" \
      --restart unless-stopped \
      --network none \
      --read-only \
      --user "$ANYTHINGLLM_UID:$ANYTHINGLLM_GID" \
      --group-add "$docker_socket_gid" \
      --cap-drop ALL \
      --security-opt no-new-privileges:true \
      --pids-limit 64 \
      --memory 128m \
      --memory-swap 128m \
      --cpus 0.25 \
      --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
      --volume /var/run/docker.sock:/var/run/docker.sock \
      --volume "$STORAGE_LOCATION/sandbox:/broker" \
      --volume "$workspace_root:/workspaces" \
      --volume "$global_skills_root:/global-skills:ro" \
      "$SANDBOX_BROKER_IMAGE" \
      --socket /broker/run.sock \
      --token-file /broker/token \
      --workspace-root /workspaces \
      --docker-workspace-root "$workspace_root" \
      --global-skills-root /global-skills \
      --docker-global-skills-root "$global_skills_root" \
      --image "$SANDBOX_IMAGE" \
      --max-concurrency "$SANDBOX_MAX_CONCURRENCY" \
      --network "$SANDBOX_NETWORK" \
      "${SANDBOX_PROXY_ARGS[@]}" \
      --socket-uid "$ANYTHINGLLM_UID" \
      --socket-gid "$ANYTHINGLLM_GID" \
      --workspace-uid "$ANYTHINGLLM_UID" \
      --workspace-gid "$ANYTHINGLLM_GID" \
      >/dev/null
  fi

  for _attempt in {1..50}; do
    if [[ -S "$sandbox_socket" ]]; then
      echo "Sandbox broker is ready."
      return
    fi
    if [[ "$(docker inspect --format '{{.State.Running}}' "$sandbox_broker_name")" != "true" ]]; then
      echo "Error: sandbox broker failed to start." >&2
      docker logs "$sandbox_broker_name" >&2
      exit 1
    fi
    sleep 0.1
  done
  echo "Error: sandbox broker did not create its socket." >&2
  docker logs "$sandbox_broker_name" >&2
  exit 1
}

if [[ "$SANDBOX_ENABLED" == "true" ]]; then
  start_sandbox_broker
fi

if [[ "$APP_RECREATE" == "true" ]] && \
  docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Replacing AnythingLLM container '$CONTAINER_NAME'..."
  docker rm --force "$CONTAINER_NAME" >/dev/null
fi

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME")" == "true" ]]; then
    echo "AnythingLLM is already running in container '$CONTAINER_NAME'."
  else
    echo "Starting existing AnythingLLM container '$CONTAINER_NAME'..."
    docker start "$CONTAINER_NAME" >/dev/null
  fi
else
  echo "Creating AnythingLLM container '$CONTAINER_NAME' from '$ANYTHINGLLM_IMAGE'..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --publish "${HOST_PORT}:3001" \
    --cap-add SYS_ADMIN \
    --add-host host.docker.internal:host-gateway \
    --volume "$STORAGE_LOCATION:/app/server/storage" \
    --volume "$STORAGE_LOCATION/.env:/app/server/.env" \
    --env STORAGE_DIR=/app/server/storage \
    --env SANDBOX_BROKER_SOCKET=/app/server/storage/sandbox/run.sock \
    --env SANDBOX_BROKER_TOKEN_FILE=/app/server/storage/sandbox/token \
    --env "AGENT_MAX_CONCURRENCY=$AGENT_MAX_CONCURRENCY" \
    --env "NO_PROXY=$ANYTHINGLLM_NO_PROXY" \
    --env "no_proxy=$ANYTHINGLLM_NO_PROXY" \
    "${PROXY_ARGS[@]}" \
    "$ANYTHINGLLM_IMAGE" >/dev/null
fi

echo "AnythingLLM: http://localhost:${HOST_PORT}"
echo "Storage:     $STORAGE_LOCATION"
echo "Logs:        docker logs -f $CONTAINER_NAME"

#!/usr/bin/env bash
# Download a published image; no local build and no data backups.
set -Eeuo pipefail
VERSION="${VERSION:-}"
CONTAINER_NAME="${CONTAINER_NAME:-anythingllm}"
BROKER_CONTAINER_NAME="${BROKER_CONTAINER_NAME:-${CONTAINER_NAME}-sandbox-broker}"
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fi
log() {
  printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}
usage() {
  cat <<'HELP'
Usage: bash deploy-image.sh [update-all|update|update-broker|install] [TAG]

update-all (default): update the application container, then automatically
update the sandbox broker if it is running. Defaults to TAG=latest.
update: update only the application container; preserve existing mounts, ports,
authentication, database and proxy settings; refuse to interrupt active Agent
tasks; restore old container if startup fails. Requires Docker and Node.js 18+.
install: start a new basic SQLite installation with a persistent Docker volume.
Requires Docker. Code execution sandbox is not included in a basic install.

TAG              Image tag to deploy (default: VERSION if set, otherwise latest)
VERSION          Optional fixed x.y.z release version (overrides default latest)
IMAGE            Override image reference, including an immutable digest
CONTAINER_NAME   Container name (default: anythingllm)
HOST_PORT        New installation port (default: 7555)
STORAGE_VOLUME   New installation volume (default: <container>-storage)
ENV_FILE         Optional absolute .env file for a new installation
CONFIG_DIR       New installation config directory (default: ./coregenie-config)
IDAAS_CONFIG_FILE Optional absolute IDaaS JSON file; enables OAuth on install
STATE_DIR        Optional absolute directory for update metadata (not data backup)
NETWORK_ENV_FILE  Optional private file with HTTP(S)_PROXY and NO_PROXY settings
CA_BUNDLE_FILE    Optional absolute PEM bundle (public roots + enterprise roots)
BROKER_IMAGE     Override the broker image for update-broker/update-all
BROKER_CONTAINER_NAME Existing broker name (default: <container>-sandbox-broker)
ALLOW_RUNNING    Set to 1 to allow interrupting active Agent tasks during update

update-broker: update an existing broker, preserving its runner image, workspace
mounts and limits. Waits for no active Agent tasks/runners before replacement.
Network/CA options are applied only when explicitly supplied and survive updates.

Download deploy-existing-container.cjs alongside this script, or let update
download it automatically. No database/file backups run.
Container rollback does not reverse database migrations.
HELP
}
case "${1:-update-all}" in
  -h|--help) usage; exit 0 ;;
  update|update-all|install|update-broker) mode="${1:-update-all}" ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 2 ]] || { usage >&2; exit 2; }
if [[ $# -eq 2 ]]; then
  if [[ "$mode" == install ]]; then usage >&2; exit 2; fi
  TAG="$2"
fi
if [[ -z "${TAG:-}" ]]; then
  if [[ -n "$VERSION" ]]; then
    [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'VERSION must be a fixed x.y.z release.' >&2; exit 2; }
    TAG="$VERSION"
  else
    TAG="latest"
  fi
fi
[[ "$TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || { echo 'TAG must be a valid Docker image tag.' >&2; exit 2; }
IMAGE="${IMAGE:-ghcr.io/acore2026/coregenie:${TAG}}"
BROKER_IMAGE="${BROKER_IMAGE:-ghcr.io/acore2026/coregenie-sandbox-broker:${TAG}}"
log "Mode: $mode | Container: $CONTAINER_NAME | Tag: $TAG"
log "Checking Docker daemon..."
command -v docker >/dev/null
docker info >/dev/null
if [[ "$mode" != install ]]; then
  command -v node >/dev/null || { echo 'Install Node.js 18+ to run the deployment helper.' >&2; exit 1; }
  helper=""
  local_helper=""
  if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/deploy-existing-container.cjs" ]]; then
    local_helper="$SCRIPT_DIR/deploy-existing-container.cjs"
  fi
  if [[ "$TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    if [[ -n "$local_helper" ]] && grep -Fxq "// CoreGenie deployment helper version: $TAG" "$local_helper"; then
      helper="$local_helper"
    else
      helper_url="https://github.com/acore2026/CoreGenie/releases/download/v${TAG}/deploy-existing-container.cjs"
    fi
  else
    if [[ -n "$local_helper" ]]; then
      helper="$local_helper"
    else
      helper_ref="master"
      if [[ "$TAG" =~ ^sha-([0-9a-f]{7,40})$ ]]; then
        helper_ref="${BASH_REMATCH[1]}"
      fi
      helper_url="https://raw.githubusercontent.com/acore2026/CoreGenie/${helper_ref}/scripts/deploy-existing-container.cjs"
    fi
  fi
  if [[ -n "$helper" ]]; then
    log "Using local deployment helper: $helper"
  else
    command -v curl >/dev/null
    temp_dir="$(mktemp -d)"
    trap 'rm -r -- "$temp_dir"' EXIT
    helper="$temp_dir/deploy-existing-container.cjs"
    log "Downloading deployment helper from $helper_url..."
    curl --fail --show-error --location --retry 3 "$helper_url" --output "$helper"
    log "Deployment helper downloaded."
  fi
  run_update() {
    local target_kind="$1" target_name="$2" target_image="$3" state_dir="${4:-}"
    local args=(--image "$target_image" --container "$target_name" --pull)
    if [[ "$target_kind" == broker ]]; then args+=(--broker --app-container "$CONTAINER_NAME"); fi
    if [[ -n "${NETWORK_ENV_FILE:-}" ]]; then args+=(--network-env-file "$NETWORK_ENV_FILE"); fi
    if [[ -n "${CA_BUNDLE_FILE:-}" ]]; then args+=(--ca-bundle "$CA_BUNDLE_FILE"); fi
    if [[ -n "$state_dir" ]]; then args+=(--state-dir "$state_dir"); fi
    if [[ "${ALLOW_RUNNING:-0}" == 1 ]]; then args+=(--allow-running); fi
    log "Updating $target_kind container '$target_name' -> $target_image"
    node "$helper" "${args[@]}"
    log "Finished updating $target_kind container '$target_name'."
  }
  if [[ "$mode" == update-broker ]]; then
    docker container inspect "$BROKER_CONTAINER_NAME" >/dev/null
    run_update broker "$BROKER_CONTAINER_NAME" "$BROKER_IMAGE" "${STATE_DIR:-}"
  elif [[ "$mode" == update-all ]]; then
    docker container inspect "$CONTAINER_NAME" >/dev/null
    app_state_dir=""
    broker_state_dir=""
    if [[ -n "${STATE_DIR:-}" ]]; then
      app_state_dir="${STATE_DIR}/app"
      broker_state_dir="${STATE_DIR}/broker"
    fi
    run_update app "$CONTAINER_NAME" "$IMAGE" "$app_state_dir"
    if docker ps --format '{{.Names}}' | grep -Fxq -- "$BROKER_CONTAINER_NAME"; then
      log "Detected running sandbox broker '$BROKER_CONTAINER_NAME'; updating next..."
      run_update broker "$BROKER_CONTAINER_NAME" "$BROKER_IMAGE" "$broker_state_dir"
    else
      log "Sandbox broker container '$BROKER_CONTAINER_NAME' is not running; skipped."
    fi
  else
    docker container inspect "$CONTAINER_NAME" >/dev/null
    run_update app "$CONTAINER_NAME" "$IMAGE" "${STATE_DIR:-}"
  fi
  log "Deployment completed."
else
  # Fail closed if the daemon is inaccessible or the name already exists.
  existing="$(docker container ls -a --format '{{.Names}}')"
  if grep -Fxq -- "$CONTAINER_NAME" <<< "$existing"; then
    echo "Container $CONTAINER_NAME already exists; use update." >&2; exit 1
  fi
  extra=()
  if [[ -n "${NETWORK_ENV_FILE:-}" ]]; then
    [[ "$NETWORK_ENV_FILE" = /* && -f "$NETWORK_ENV_FILE" ]] || { echo 'NETWORK_ENV_FILE must be an existing absolute path.' >&2; exit 2; }
    extra+=(--env-file "$NETWORK_ENV_FILE" --env NODE_USE_ENV_PROXY=1)
  fi
  if [[ -n "${CA_BUNDLE_FILE:-}" ]]; then
    [[ "$CA_BUNDLE_FILE" = /* && -f "$CA_BUNDLE_FILE" && "$CA_BUNDLE_FILE" != *,* ]] || { echo 'CA_BUNDLE_FILE must be an existing absolute mount-safe path.' >&2; exit 2; }
    extra+=(--mount "type=bind,source=$CA_BUNDLE_FILE,target=/etc/coregenie/ca-bundle.pem,readonly"
      --env NODE_EXTRA_CA_CERTS=/etc/coregenie/ca-bundle.pem --env SSL_CERT_FILE=/etc/coregenie/ca-bundle.pem)
  fi
  if [[ -n "${IDAAS_CONFIG_FILE:-}" ]]; then
    [[ "$IDAAS_CONFIG_FILE" = /* && -f "$IDAAS_CONFIG_FILE" ]] || { echo 'IDAAS_CONFIG_FILE must be an existing absolute path.' >&2; exit 2; }
    extra+=(--mount "type=bind,source=$IDAAS_CONFIG_FILE,target=/app/idaas.json,readonly"
      --env COREGENIE_AUTH_MODE=idaas --env COREGENIE_IDAAS_CONFIG_FILE=/app/idaas.json)
  fi
  if [[ -n "${ENV_FILE:-}" ]]; then
    [[ "$ENV_FILE" = /* && -f "$ENV_FILE" ]] || { echo 'ENV_FILE must be an existing absolute path.' >&2; exit 2; }
  fi
  log "Pulling image $IMAGE..."
  docker pull "$IMAGE"
  image_id="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
  if [[ -z "${ENV_FILE:-}" ]]; then
    mkdir -p -- "${CONFIG_DIR:-$PWD/coregenie-config}"
    config_dir="$(cd -- "${CONFIG_DIR:-$PWD/coregenie-config}" && pwd)"
    log "Initializing .env in $config_dir (if missing)..."
    docker run --rm --user root --entrypoint /bin/sh \
      --mount "type=bind,source=$config_dir,target=/config" "$image_id" -ec \
      'if [ ! -e /config/.env ]; then cp /app/server/.env /config/.env; chown --reference=/app/server/.env /config/.env; chmod 600 /config/.env; fi'
    ENV_FILE="$config_dir/.env"
  fi
  log "Starting container '$CONTAINER_NAME' on port ${HOST_PORT:-7555}..."
  docker run -d --name "$CONTAINER_NAME" --restart unless-stopped \
    --publish "${HOST_PORT:-7555}:3001" \
    --mount "type=volume,source=${STORAGE_VOLUME:-${CONTAINER_NAME}-storage},target=/app/server/storage" \
    --env-file "$ENV_FILE" --mount "type=bind,source=$ENV_FILE,target=/app/server/.env" \
    --env STORAGE_DIR=/app/server/storage "${extra[@]}" "$image_id"
  last_status=""
  for ((i=0; i<90; i++)); do
    status="$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER_NAME")"
    if [[ "$status" == 'running healthy' ]]; then
      log "CoreGenie $TAG is ready on port ${HOST_PORT:-7555}."; exit 0
    fi
    [[ "$status" == running* ]] || break
    if [[ "$status" != "$last_status" || $((i % 5)) -eq 0 ]]; then
      log "Waiting for '$CONTAINER_NAME' to become healthy ($((i * 2))s/180s, status: ${status:-unknown})..."
      last_status="$status"
    fi
    sleep 2
  done
  echo "Startup failed. Inspect: docker logs $CONTAINER_NAME. Persistent data is retained." >&2
  exit 1
fi

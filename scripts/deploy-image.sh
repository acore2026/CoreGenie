#!/usr/bin/env bash
# Download a published image; no local build and no data backups.
set -Eeuo pipefail
VERSION="${VERSION:-1.15.3}"
IMAGE="${IMAGE:-ghcr.io/acore2026/coregenie:${VERSION}}"
CONTAINER_NAME="${CONTAINER_NAME:-anythingllm}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
usage() {
  cat <<'HELP'
Usage: bash deploy-image.sh [update|install|update-broker]

update (default): preserve existing mounts, ports, authentication, database and
proxy settings; refuse to interrupt active Agent tasks; restore old container
if startup fails. Requires Docker and Node.js 18+ on the host.
install: start a new basic SQLite installation with a persistent Docker volume.
Requires Docker. Code execution sandbox is not included in a basic install.

VERSION          Image version and deployment helper release (default: 1.15.3)
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
BROKER_IMAGE     Override the versioned broker image for update-broker
BROKER_CONTAINER_NAME Existing broker name (default: <container>-sandbox-broker)

update-broker: update an existing broker, preserving its runner image, workspace
mounts and limits. Waits for no active Agent tasks/runners before replacement.
Network/CA options are applied only when explicitly supplied and survive updates.

Download deploy-existing-container.cjs from the same release alongside this
script, or let update download it automatically. No database/file backups run.
Container rollback does not reverse database migrations.
HELP
}
case "${1:-update}" in
  -h|--help) usage; exit 0 ;;
  update|install|update-broker) mode="${1:-update}" ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'VERSION must be a fixed x.y.z release.' >&2; exit 2; }
command -v docker >/dev/null
docker info >/dev/null
if [[ "$mode" != install ]]; then
  command -v node >/dev/null || { echo 'Install Node.js 18+ to run the deployment helper.' >&2; exit 1; }
  target_name="$CONTAINER_NAME"
  target_image="$IMAGE"
  if [[ "$mode" == update-broker ]]; then
    target_name="${BROKER_CONTAINER_NAME:-${CONTAINER_NAME}-sandbox-broker}"
    target_image="${BROKER_IMAGE:-ghcr.io/acore2026/coregenie-sandbox-broker:${VERSION}}"
  fi
  docker container inspect "$target_name" >/dev/null
  helper="$SCRIPT_DIR/deploy-existing-container.cjs"
  if [[ ! -f "$helper" ]] || ! grep -Fxq "// CoreGenie deployment helper version: $VERSION" "$helper"; then
    command -v curl >/dev/null
    temp_dir="$(mktemp -d)"
    trap 'rm -r -- "$temp_dir"' EXIT
    helper="$temp_dir/deploy-existing-container.cjs"
    curl --fail --show-error --location --retry 3 \
      "https://github.com/acore2026/CoreGenie/releases/download/v${VERSION}/deploy-existing-container.cjs" \
      --output "$helper"
  fi
  args=(--image "$target_image" --container "$target_name" --pull)
  if [[ "$mode" == update-broker ]]; then args+=(--broker --app-container "$CONTAINER_NAME"); fi
  if [[ -n "${NETWORK_ENV_FILE:-}" ]]; then args+=(--network-env-file "$NETWORK_ENV_FILE"); fi
  if [[ -n "${CA_BUNDLE_FILE:-}" ]]; then args+=(--ca-bundle "$CA_BUNDLE_FILE"); fi
  if [[ -n "${STATE_DIR:-}" ]]; then args+=(--state-dir "$STATE_DIR"); fi
  node "$helper" "${args[@]}"
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
  docker pull "$IMAGE"
  image_id="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
  if [[ -z "${ENV_FILE:-}" ]]; then
    mkdir -p -- "${CONFIG_DIR:-$PWD/coregenie-config}"
    config_dir="$(cd -- "${CONFIG_DIR:-$PWD/coregenie-config}" && pwd)"
    docker run --rm --user root --entrypoint /bin/sh \
      --mount "type=bind,source=$config_dir,target=/config" "$image_id" -ec \
      'if [ ! -e /config/.env ]; then cp /app/server/.env /config/.env; chown --reference=/app/server/.env /config/.env; chmod 600 /config/.env; fi'
    ENV_FILE="$config_dir/.env"
  fi
  docker run -d --name "$CONTAINER_NAME" --restart unless-stopped \
    --publish "${HOST_PORT:-7555}:3001" \
    --mount "type=volume,source=${STORAGE_VOLUME:-${CONTAINER_NAME}-storage},target=/app/server/storage" \
    --env-file "$ENV_FILE" --mount "type=bind,source=$ENV_FILE,target=/app/server/.env" \
    --env STORAGE_DIR=/app/server/storage "${extra[@]}" "$image_id"
  for ((i=0; i<90; i++)); do
    status="$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER_NAME")"
    if [[ "$status" == 'running healthy' ]]; then
      echo "CoreGenie $VERSION is ready on port ${HOST_PORT:-7555}."; exit 0
    fi
    [[ "$status" == running* ]] || break
    sleep 2
  done
  echo "Startup failed. Inspect: docker logs $CONTAINER_NAME. Persistent data is retained." >&2
  exit 1
fi

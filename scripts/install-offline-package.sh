#!/usr/bin/env bash

set -Eeuo pipefail

INPUT="${1:-.}"
if [[ ! -e "$INPUT" ]]; then
  echo "Error: package path does not exist: $INPUT" >&2
  exit 1
fi

PACKAGE_ROOT=""
if [[ -f "$INPUT" ]]; then
  EXTRACT_DIR="${OFFLINE_PACKAGE_EXTRACT_DIR:-$PWD/anythingllm-offline-package}"
  mkdir -p "$EXTRACT_DIR"
  tar -xzf "$INPUT" -C "$EXTRACT_DIR"
  PACKAGE_ROOT="$(cd "$EXTRACT_DIR" && pwd -P)"
else
  PACKAGE_ROOT="$(cd "$INPUT" && pwd -P)"
fi

if [[ ! -f "$PACKAGE_ROOT/manifest.json" ]]; then
  echo "Error: manifest.json was not found in $PACKAGE_ROOT." >&2
  exit 1
fi

read_manifest_value() {
  local key="$1"
  node - "$PACKAGE_ROOT/manifest.json" "$key" <<'NODE'
const fs = require("fs");
const [manifestPath, key] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (typeof manifest[key] !== "string" || !manifest[key]) process.exit(1);
process.stdout.write(manifest[key]);
NODE
}

APP_IMAGE="${ANYTHINGLLM_IMAGE:-$(read_manifest_value appImage)}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-$(read_manifest_value postgresImage)}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required on the target server." >&2
  exit 1
fi

echo "Loading application image '$APP_IMAGE'..."
docker load -i "$PACKAGE_ROOT/images/anythingllm.tar" >/dev/null
echo "Loading PostgreSQL image '$POSTGRES_IMAGE'..."
docker load -i "$PACKAGE_ROOT/images/postgres.tar" >/dev/null

# Sandbox images ship with the package; the start script builds them itself
# only if they are missing, so loading them here keeps the target offline.
if [[ -f "$PACKAGE_ROOT/images/sandbox.tar" ]]; then
  SANDBOX_IMAGE="${SANDBOX_IMAGE:-$(read_manifest_value sandboxImage)}"
  echo "Loading sandbox image '$SANDBOX_IMAGE'..."
  docker load -i "$PACKAGE_ROOT/images/sandbox.tar" >/dev/null
fi
if [[ -f "$PACKAGE_ROOT/images/sandbox-broker.tar" ]]; then
  SANDBOX_BROKER_IMAGE="${SANDBOX_BROKER_IMAGE:-$(read_manifest_value sandboxBrokerImage)}"
  echo "Loading sandbox broker image '$SANDBOX_BROKER_IMAGE'..."
  docker load -i "$PACKAGE_ROOT/images/sandbox-broker.tar" >/dev/null
fi

export ANYTHINGLLM_IMAGE="$APP_IMAGE"
export POSTGRES_IMAGE="$POSTGRES_IMAGE"
export OFFLINE_GLOBAL_DATA_PACKAGE="$PACKAGE_ROOT/global-data"

# Sandbox runs by default; set SANDBOX_ENABLED=false to deploy without it.
export SANDBOX_ENABLED="${SANDBOX_ENABLED:-true}"
# Evaluation UI is optional and needs its own image; keep it off by default.
export PROMPTFOO_ENABLED="${PROMPTFOO_ENABLED:-false}"
export STORAGE_LOCATION="${STORAGE_LOCATION:-$HOME/anythingllm}"

# Ship the source .env into the new storage location on first install so the
# target keeps model providers, API keys and JWT secrets without re-entry.
if [[ -f "$PACKAGE_ROOT/config/.env" && ! -f "$STORAGE_LOCATION/.env" ]]; then
  mkdir -p "$STORAGE_LOCATION"
  cp "$PACKAGE_ROOT/config/.env" "$STORAGE_LOCATION/.env"
  echo "Installed packaged .env into $STORAGE_LOCATION/.env"
fi

# Bind the shipped agent configuration directory so prompt/Agent/Skill file
# sync works the same way as on the source installation.
if [[ -d "$PACKAGE_ROOT/agent-config" ]]; then
  export AGENT_CONFIG_SYNC_ENABLED="${AGENT_CONFIG_SYNC_ENABLED:-true}"
  export AGENT_CONFIG_SYNC_DIR="${AGENT_CONFIG_SYNC_DIR:-$PACKAGE_ROOT/agent-config}"
fi

exec "$PACKAGE_ROOT/start-anythingllm.sh"

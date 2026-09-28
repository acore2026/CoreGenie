#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUTPUT_DIR="${OFFLINE_PACKAGE_OUTPUT:-$SCRIPT_DIR/offline-package}"
ARCHIVE_PATH=""
APP_IMAGE="${ANYTHINGLLM_IMAGE:-anythingllm:offline}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:17-alpine}"
SANDBOX_IMAGE="${SANDBOX_IMAGE:-anythingllm-sandbox:local}"
SANDBOX_BROKER_IMAGE="${SANDBOX_BROKER_IMAGE:-anythingllm-sandbox-broker:local}"
SOURCE_STORAGE="${STORAGE_DIR:-$SCRIPT_DIR/server/storage}"
ENV_FILE=""
SKIP_BUILD="false"
SKIP_SANDBOX="false"

usage() {
  cat <<'EOF'
Create an offline AnythingLLM deployment package.

Usage:
  scripts/create-offline-package.sh [options]

Options:
  --output DIR          Package directory (default: ./offline-package)
  --archive FILE        Also write a .tar.gz archive at FILE
  --image IMAGE         AnythingLLM image tag (default: anythingllm:offline)
  --postgres-image IMG  PostgreSQL image tag (default: postgres:17-alpine)
  --sandbox-image IMG   Sandbox runner image tag (default: anythingllm-sandbox:local)
  --sandbox-broker-image IMG
                        Sandbox broker image tag (default: anythingllm-sandbox-broker:local)
  --storage-root DIR    Source STORAGE_DIR (default: server/storage)
  --env-file FILE       Source .env to ship (default: <storage-root>/.env)
  --skip-build          Fail if the application image does not already exist
  --skip-sandbox        Do not ship sandbox images
  -h, --help            Show this help

The source service must be stopped before export so the global database and
LanceDB snapshot are consistent. The package includes no Workspace rows.

The application image must contain server/scripts/offline/global-data.js;
images built before that script existed cannot run the import step and are
rebuilt unless --skip-build is given.
EOF
}

while (($#)); do
  case "$1" in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --archive)
      ARCHIVE_PATH="$2"
      shift 2
      ;;
    --image)
      APP_IMAGE="$2"
      shift 2
      ;;
    --postgres-image)
      POSTGRES_IMAGE="$2"
      shift 2
      ;;
    --sandbox-image)
      SANDBOX_IMAGE="$2"
      shift 2
      ;;
    --sandbox-broker-image)
      SANDBOX_BROKER_IMAGE="$2"
      shift 2
      ;;
    --storage-root)
      SOURCE_STORAGE="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD="true"
      shift
      ;;
    --skip-sandbox)
      SKIP_SANDBOX="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required to build an offline package." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required to export global data." >&2
  exit 1
fi

OUTPUT_DIR="$(mkdir -p "$OUTPUT_DIR" && cd "$OUTPUT_DIR" && pwd -P)"
SOURCE_STORAGE="$(cd "$SOURCE_STORAGE" && pwd -P)"
ENV_FILE="${ENV_FILE:-$SOURCE_STORAGE/.env}"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/anythingllm-offline-package.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

build_image_if_missing() {
  local image="$1"
  local dockerfile="$2"
  if docker image inspect "$image" >/dev/null 2>&1; then
    return
  fi
  echo "Building image '$image'..."
  docker build --tag "$image" --file "$dockerfile" "$SCRIPT_DIR"
}

if ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then
  if [[ "$SKIP_BUILD" == "true" ]]; then
    echo "Error: application image '$APP_IMAGE' is not available." >&2
    exit 1
  fi
  echo "Building application image '$APP_IMAGE'..."
  docker build --tag "$APP_IMAGE" --file "$SCRIPT_DIR/docker/Dockerfile" "$SCRIPT_DIR"
else
  # The import step runs inside the application image, so the image must
  # contain the offline scripts. Older images predate them.
  if ! docker run --rm --entrypoint /bin/sh "$APP_IMAGE" -c \
    'test -f /app/server/scripts/offline/global-data.js' >/dev/null 2>&1; then
    if [[ "$SKIP_BUILD" == "true" ]]; then
      echo "Error: application image '$APP_IMAGE' has no offline import script." >&2
      echo "Rebuild it without --skip-build." >&2
      exit 1
    fi
    echo "Application image predates offline import; rebuilding '$APP_IMAGE'..."
    docker build --tag "$APP_IMAGE" --file "$SCRIPT_DIR/docker/Dockerfile" "$SCRIPT_DIR"
  fi
fi

if ! docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1; then
  echo "Error: PostgreSQL image '$POSTGRES_IMAGE' is not available locally." >&2
  echo "Pull it while online, then run this command again." >&2
  exit 1
fi

if [[ "$SKIP_SANDBOX" != "true" ]]; then
  build_image_if_missing "$SANDBOX_IMAGE" "$SCRIPT_DIR/sandbox/Dockerfile"
  build_image_if_missing "$SANDBOX_BROKER_IMAGE" "$SCRIPT_DIR/sandbox/Dockerfile.broker"
fi

mkdir -p "$STAGING_DIR/images"
echo "Exporting global data from '$SOURCE_STORAGE'..."
if [[ "${DATABASE_PROVIDER:-postgresql}" == "postgres" || "${DATABASE_PROVIDER:-postgresql}" == "postgresql" ]]; then
  (cd "$SCRIPT_DIR/server" && node scripts/postgres/prepare-schema.js && npx prisma generate --schema=./prisma-postgresql/schema.prisma)
fi
STORAGE_DIR="$SOURCE_STORAGE" \
DATABASE_PROVIDER="${DATABASE_PROVIDER:-postgresql}" \
node "$SCRIPT_DIR/server/scripts/offline/global-data.js" \
  export --output "$STAGING_DIR/global-data"

echo "Saving Docker images..."
docker save "$APP_IMAGE" -o "$STAGING_DIR/images/anythingllm.tar"
docker save "$POSTGRES_IMAGE" -o "$STAGING_DIR/images/postgres.tar"
if [[ "$SKIP_SANDBOX" != "true" ]]; then
  docker save "$SANDBOX_IMAGE" -o "$STAGING_DIR/images/sandbox.tar"
  docker save "$SANDBOX_BROKER_IMAGE" -o "$STAGING_DIR/images/sandbox-broker.tar"
fi

if [[ -f "$ENV_FILE" ]]; then
  echo "Shipping environment file '$ENV_FILE'..."
  mkdir -p "$STAGING_DIR/config"
  cp "$ENV_FILE" "$STAGING_DIR/config/.env"
fi

if [[ -d "$SCRIPT_DIR/agent-config" ]]; then
  echo "Shipping agent configuration from '$SCRIPT_DIR/agent-config'..."
  cp -a "$SCRIPT_DIR/agent-config" "$STAGING_DIR/agent-config"
fi

cp "$SCRIPT_DIR/start-anythingllm.sh" "$STAGING_DIR/start-anythingllm.sh"
cp "$SCRIPT_DIR/scripts/install-offline-package.sh" "$STAGING_DIR/install-offline-package.sh"
chmod +x "$STAGING_DIR/start-anythingllm.sh" "$STAGING_DIR/install-offline-package.sh"

node - "$STAGING_DIR/manifest.json" "$APP_IMAGE" "$POSTGRES_IMAGE" \
  "$SANDBOX_IMAGE" "$SANDBOX_BROKER_IMAGE" "$SKIP_SANDBOX" <<'NODE'
const fs = require("fs");
const path = require("path");
const [manifestPath, appImage, postgresImage, sandboxImage, sandboxBrokerImage, skipSandbox] =
  process.argv.slice(2);
const packageRoot = path.dirname(manifestPath);
const globalManifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "global-data", "manifest.json"), "utf8")
);
const manifest = {
  format: "anythingllm-offline-deployment",
  version: 1,
  createdAt: new Date().toISOString(),
  appImage,
  postgresImage,
  architecture: process.arch,
  globalData: globalManifest,
};
if (skipSandbox !== "true") {
  manifest.sandboxImage = sandboxImage;
  manifest.sandboxBrokerImage = sandboxBrokerImage;
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
cp -a "$STAGING_DIR/." "$OUTPUT_DIR/"

if [[ -n "$ARCHIVE_PATH" ]]; then
  ARCHIVE_PATH="$(mkdir -p "$(dirname "$ARCHIVE_PATH")" && cd "$(dirname "$ARCHIVE_PATH")" && pwd -P)/$(basename "$ARCHIVE_PATH")"
  tar -C "$OUTPUT_DIR" -czf "$ARCHIVE_PATH" .
  echo "Archive created: $ARCHIVE_PATH"
fi

echo "Offline package created: $OUTPUT_DIR"
echo "Install with: $OUTPUT_DIR/install-offline-package.sh $OUTPUT_DIR"

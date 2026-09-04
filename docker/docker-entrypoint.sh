#!/bin/bash

# Check if STORAGE_DIR is set
if [ -z "$STORAGE_DIR" ]; then
    echo "================================================================"
    echo "⚠️  ⚠️  ⚠️  WARNING: STORAGE_DIR environment variable is not set! ⚠️  ⚠️  ⚠️"
    echo ""
    echo "Not setting this will result in data loss on container restart since"
    echo "the application will not have a persistent storage location."
    echo "It can also result in weird errors in various parts of the application."
    echo ""
    echo "Please run the container with the official docker command at"
    echo "https://docs.anythingllm.com/installation-docker/quickstart"
    echo ""
    echo "⚠️  ⚠️  ⚠️  WARNING: STORAGE_DIR environment variable is not set! ⚠️  ⚠️  ⚠️"
    echo "================================================================"
fi

{
  cd /app/server/ &&
    # Disable Prisma CLI telemetry (https://www.prisma.io/docs/orm/tools/prisma-cli#how-to-opt-out-of-data-collection)
    export CHECKPOINT_DISABLE=1 &&
    if [ "${DATABASE_PROVIDER:-sqlite}" = "postgresql" ] || [ "${DATABASE_PROVIDER:-sqlite}" = "postgres" ]; then
      node ./scripts/postgres/prepare-schema.js
      PRISMA_SCHEMA_PATH=./prisma-postgresql/schema.prisma
    else
      PRISMA_SCHEMA_PATH=./prisma/schema.prisma
    fi &&
    npx prisma generate --schema="$PRISMA_SCHEMA_PATH" &&
    npx prisma migrate deploy --schema="$PRISMA_SCHEMA_PATH" &&
    npx prisma db seed --schema="$PRISMA_SCHEMA_PATH" &&
    node /app/server/index.js
} &
{ node /app/collector/index.js; } &
wait -n
exit $?

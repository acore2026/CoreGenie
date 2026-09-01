#!/usr/bin/env bash

set -Eeuo pipefail

command_name="${1:-help}"
container_name="${PROMPTFOO_CONTAINER_NAME:-anythingllm-promptfoo}"
storage_dir="${PROMPTFOO_STORAGE:-/root/anythingllm/promptfoo}"
secret_file="${PROMPTFOO_SECRET_FILE:-/root/anythingllm/promptfoo-secrets.env}"
backup_dir="${PROMPTFOO_BACKUP_DIR:-/root/anythingllm/promptfoo-backups}"

case "$command_name" in
  run)
    docker exec --workdir /opt/anythingllm-evals "$container_name" \
      node scripts/smoke.js
    docker exec --workdir /opt/anythingllm-evals "$container_name" \
      promptfoo eval \
      --config /opt/anythingllm-evals/promptfooconfig.bootstrap.yaml \
      --no-cache \
      --repeat 3 \
      --max-concurrency 1
    ;;
  smoke)
    curl --fail --silent --show-error "http://localhost:${PROMPTFOO_PORT:-7391}" >/dev/null
    docker exec --workdir /opt/anythingllm-evals "$container_name" \
      node scripts/smoke.js
    ;;
  cleanup)
    cleanup_option=()
    if [[ "${2:-}" == "--all" ]]; then cleanup_option+=(--all); fi
    docker run --rm \
      --add-host host.docker.internal:host-gateway \
      --env-file "$secret_file" \
      --entrypoint node \
      "$(docker inspect --format '{{.Config.Image}}' "$container_name")" \
      /opt/anythingllm-evals/scripts/cleanup-workspaces.js \
      "${cleanup_option[@]}"
    ;;
  backup)
    storage_dir="$(cd "$storage_dir" && pwd -P)"
    mkdir -p -- "$backup_dir"
    backup_dir="$(cd "$backup_dir" && pwd -P)"
    if [[ "$storage_dir" == "/" || "$backup_dir" == "/" ]]; then
      echo "Refusing to back up a root directory." >&2
      exit 1
    fi
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    docker stop "$container_name" >/dev/null
    trap 'docker start "$container_name" >/dev/null 2>&1 || true' EXIT
    tar --create --gzip \
      --file "$backup_dir/promptfoo-$timestamp.tar.gz" \
      --directory "$(dirname "$storage_dir")" \
      "$(basename "$storage_dir")"
    docker start "$container_name" >/dev/null
    trap - EXIT
    mapfile -t old_backups < <(
      find "$backup_dir" -maxdepth 1 -type f -name 'promptfoo-*.tar.gz' \
        -printf '%T@ %p\n' | sort -nr | tail -n +11 | cut -d' ' -f2-
    )
    for old_backup in "${old_backups[@]}"; do rm -- "$old_backup"; done
    echo "Backup saved to $backup_dir/promptfoo-$timestamp.tar.gz"
    ;;
  *)
    cat <<'EOF'
Usage: promptfoo-admin.sh <command>

Commands:
  run             Run all 10 live cases three times with no cache.
  smoke           Check the Promptfoo UI and AnythingLLM Agent API.
  cleanup         Remove evaluation workspaces older than 24 hours.
  cleanup --all   Remove every workspace whose slug starts with eval-.
  backup          Back up Promptfoo SQLite/blob state and retain 10 archives.
EOF
    ;;
esac

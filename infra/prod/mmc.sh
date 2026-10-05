#!/usr/bin/env bash
# MMC Core production helper — run from anywhere; works on this PC and on the VPS.
#
#   ./mmc.sh init                 create .env with strong random secrets (once)
#   ./mmc.sh build [amd64|arm64]  build the api + web images (default: this machine's arch)
#   ./mmc.sh up | down | restart  start / stop the stack
#   ./mmc.sh ps | logs [service]  status / follow logs
#   ./mmc.sh backup               dump the database + uploaded files to ./backups/
#   ./mmc.sh restore <dir>        restore a backup made by `backup` (stops api/worker meanwhile)
#   ./mmc.sh export [amd64]       build (for the VPS arch) and save images to mmc-images-<tag>.tar.gz
#   ./mmc.sh import <file>        load images on the VPS from that tarball
#   ./mmc.sh import-legacy <dir>  migrate the old tool's JSON files (mounted read-only)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
COMPOSE=(docker compose --env-file "$HERE/.env" -f "$HERE/docker-compose.yml")
TAG="${IMAGE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M)}"

need_env() { [[ -f "$HERE/.env" ]] || { echo "No .env — run: ./mmc.sh init" >&2; exit 1; }; }
set_tag() { if grep -q '^IMAGE_TAG=' "$HERE/.env"; then sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" "$HERE/.env" && rm -f "$HERE/.env.bak"; else echo "IMAGE_TAG=$1" >> "$HERE/.env"; fi; }

build() {
  local plat=""
  case "${1:-}" in amd64) plat="--platform=linux/amd64";; arm64) plat="--platform=linux/arm64";; "") ;; *) echo "arch must be amd64 or arm64"; exit 1;; esac
  docker build $plat -f "$ROOT/apps/api/Dockerfile" -t "mmc-api:$TAG" -t mmc-api:latest "$ROOT"
  docker build $plat -f "$ROOT/apps/web/Dockerfile" -t "mmc-web:$TAG" -t mmc-web:latest "$ROOT"
  [[ -f "$HERE/.env" ]] && set_tag "$TAG"
  echo "Built mmc-api:$TAG and mmc-web:$TAG"
}

case "${1:-}" in
  init)
    [[ -f "$HERE/.env" ]] && { echo ".env already exists"; exit 0; }
    cp "$HERE/.env.example" "$HERE/.env"
    for k in POSTGRES_PASSWORD APP_DB_PASSWORD BETTER_AUTH_SECRET PAYMENTS_WEBHOOK_SECRET ESIGN_WEBHOOK_SECRET LEADS_WEBHOOK_SECRET WHATSAPP_VERIFY_TOKEN; do
      v="$(openssl rand -hex 24)"; sed -i.bak "s|^$k=.*|$k=$v|" "$HERE/.env"
    done
    rm -f "$HERE/.env.bak"; chmod 600 "$HERE/.env"
    echo "Created .env with random secrets. Set OWNER_EMAIL (and PUBLIC_URL / SITE_ADDRESS on the VPS)."
    ;;
  build) build "${2:-}" ;;
  up) need_env; "${COMPOSE[@]}" up -d; "${COMPOSE[@]}" ps ;;
  down) need_env; "${COMPOSE[@]}" down ;;
  restart) need_env; "${COMPOSE[@]}" up -d --force-recreate api worker web caddy ;;
  ps) need_env; "${COMPOSE[@]}" ps ;;
  logs) need_env; "${COMPOSE[@]}" logs -f --tail=200 ${2:-} ;;
  backup)
    need_env; d="$HERE/backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d"
    "${COMPOSE[@]}" exec -T postgres pg_dump -U mmc -Fc mmc > "$d/mmc.dump"
    "${COMPOSE[@]}" run --rm -T --no-deps --entrypoint tar api -C /data -czf - files > "$d/files.tar.gz"
    echo "Backup written to $d"
    ;;
  restore)
    need_env; d="${2:?usage: restore <backup-dir>}"
    "${COMPOSE[@]}" stop api worker
    "${COMPOSE[@]}" exec -T postgres pg_restore -U mmc -d mmc --clean --if-exists < "$d/mmc.dump"
    "${COMPOSE[@]}" run --rm -T --no-deps --entrypoint tar api -C /data -xzf - < "$d/files.tar.gz"
    "${COMPOSE[@]}" up -d api worker
    echo "Restored from $d"
    ;;
  export)
    build "${2:-amd64}"
    f="$HERE/mmc-images-$TAG.tar.gz"
    docker save "mmc-api:$TAG" "mmc-web:$TAG" | gzip > "$f"
    echo "Saved $f ($(du -h "$f" | cut -f1)). Copy it with docker-compose.yml, Caddyfile, mmc.sh and .env.example to the VPS."
    ;;
  import)
    f="${2:?usage: import <mmc-images-*.tar.gz>}"
    gunzip -c "$f" | docker load
    t="$(basename "$f" .tar.gz)"; t="${t#mmc-images-}"
    docker tag "mmc-api:$t" mmc-api:latest; docker tag "mmc-web:$t" mmc-web:latest
    [[ -f "$HERE/.env" ]] && set_tag "$t"
    echo "Loaded images with tag $t"
    ;;
  import-legacy)
    need_env; dir="$(cd "${2:?usage: import-legacy <folder-with-old-json>}" && pwd)"
    "${COMPOSE[@]}" run --rm --no-deps -v "$dir:/legacy:ro" --entrypoint node api node_modules/@mmc/db/dist/import-legacy.js --dir /legacy ${3:-}
    ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac

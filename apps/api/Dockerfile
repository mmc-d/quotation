# MMC Core API — the same image runs the API, the background worker and the one-shot migration.
# Build from the repository root:   docker build -f apps/api/Dockerfile -t mmc-api .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter "@mmc/api..." \
 && pnpm --filter "@mmc/api..." build \
 && pnpm --filter @mmc/api deploy --prod /out \
 && rm -rf /out/src /out/test /out/.data

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S mmc && adduser -S mmc -G mmc && mkdir -p /data/files && chown mmc:mmc /data/files
COPY --from=build --chown=mmc:mmc /out ./
USER mmc
ENV FILES_DIR=/data/files API_PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
# api:     node dist/main.js           (set WORKER_IN_PROCESS=false when a separate worker runs)
# worker:  node dist/worker.js
# migrate: node node_modules/@mmc/db/dist/migrate.js && node node_modules/@mmc/db/dist/seed.js
CMD ["node", "--enable-source-maps", "dist/main.js"]

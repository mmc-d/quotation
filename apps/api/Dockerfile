# MMC Core API (+ worker). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t mmc-api .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @mmc/api... build \
 && pnpm --filter @mmc/api deploy --prod --legacy /out \
 && cp -r packages/db/migrations /out/migrations

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S mmc && adduser -S mmc -G mmc
COPY --from=build --chown=mmc:mmc /out ./
USER mmc
EXPOSE 4000
# Cloud Run: one service runs the API (WORKER_IN_PROCESS=false) and a second the worker (CMD node dist/worker.js).
CMD ["node", "--enable-source-maps", "dist/main.js"]

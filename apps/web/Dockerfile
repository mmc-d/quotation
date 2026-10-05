# MMC Core web (staff app + public pages). Build from the repository root:
#   docker build -f apps/web/Dockerfile -t mmc-web .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile && pnpm --filter @mmc/domain build && pnpm --filter @mmc/web build

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S mmc && adduser -S mmc -G mmc
COPY --from=build --chown=mmc:mmc /repo /app
USER mmc
WORKDIR /app/apps/web
EXPOSE 3000
# API_INTERNAL_URL points at the API service (the browser only talks to this origin).
CMD ["node_modules/.bin/next", "start", "--port", "3000"]

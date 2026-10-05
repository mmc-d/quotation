# MMC Core web (staff app + public customer pages), Next.js standalone output.
# Build from the repository root:   docker build -f apps/web/Dockerfile -t mmc-web .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
# Rewrites are resolved at build time: where the web container reaches the API inside the stack.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/domain ./packages/domain
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter "@mmc/web..." \
 && pnpm --filter @mmc/domain build \
 && pnpm --filter @mmc/web build \
 && mkdir -p apps/web/public

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
RUN addgroup -S mmc && adduser -S mmc -G mmc
COPY --from=build --chown=mmc:mmc /repo/apps/web/.next/standalone ./
COPY --from=build --chown=mmc:mmc /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=mmc:mmc /repo/apps/web/public ./apps/web/public
USER mmc
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]

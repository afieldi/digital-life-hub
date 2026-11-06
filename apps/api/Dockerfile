FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
# Download every dependency from the lockfile alone, so this layer stays cached
# until the lockfile changes; package.json pins the pnpm version for corepack.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
# Server modules are bundled into the API from their source, so they need their deps too.
RUN pnpm install --offline --frozen-lockfile --filter @dlh/api... --filter "./modules/*"
RUN pnpm --filter @dlh/api build
RUN pnpm --filter @dlh/api deploy --prod /out
# Core's and each module's migrations, keeping their repo-relative paths (modules may have none).
RUN for d in packages/db/drizzle modules/*/drizzle; do \
      [ -d "$d" ] && mkdir -p "/migrations/$(dirname "$d")" && cp -r "$d" "/migrations/$d"; \
    done; mkdir -p /migrations

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production MIGRATE_ON_START=1 MIGRATIONS_ROOT=/app HOST=0.0.0.0
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /migrations ./
USER node
EXPOSE 8787
CMD ["node", "dist/main.js"]

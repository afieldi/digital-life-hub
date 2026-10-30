FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @dlh/api...
RUN pnpm --filter @dlh/api build
RUN pnpm --filter @dlh/api deploy --prod /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production MIGRATE_ON_START=1 HOST=0.0.0.0
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
USER node
EXPOSE 8787
CMD ["node", "dist/main.js"]

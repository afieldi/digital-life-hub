# The Slack bot. It opens a Socket Mode connection out to Slack and talks to the
# hub API over the internal network; it publishes no port and holds no data.
# Run from the repo root: `docker build -f apps/slack/Dockerfile .`.
FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY . .
# Runs from source with tsx (a dev dependency, so install them too): its
# workspace packages ship TypeScript.
RUN pnpm install --frozen-lockfile --filter "@dlh/slack..."
ENV NODE_ENV=production
WORKDIR /repo/apps/slack
USER node
# tsx directly, not `pnpm exec`: as `node`, corepack would re-download pnpm each start.
CMD ["node_modules/.bin/tsx", "src/main.ts"]

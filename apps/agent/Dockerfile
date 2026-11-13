# The agent worker. It runs on the VPS next to the Docker daemon and shells out
# to the `docker` CLI to start one run container per agent run. Run from the
# repo root: `docker build -f apps/agent/Dockerfile .`.
FROM docker:29-cli AS docker

FROM node:22-slim
RUN corepack enable
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /repo
COPY . .
# Like the API image, but the worker runs from source with tsx (a dev
# dependency, so install them too): its workspace packages ship TypeScript.
# Every module's too, as in the runner image: @dlh/agent-protocol imports each
# module's description by path, not as a dependency.
RUN pnpm install --frozen-lockfile --filter "@dlh/agent..." --filter "./modules/*..."
ENV NODE_ENV=production
WORKDIR /repo/apps/agent
# Root on purpose: the worker chowns each run's socket dir to the run
# container's user (1000:1000), and the Docker socket is root-equivalent anyway.
CMD ["pnpm", "exec", "tsx", "src/main.ts"]

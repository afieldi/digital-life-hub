# The Docker tests' harness, for a host whose Docker runs in a VM (Docker
# Desktop on macOS): a run's Unix socket can't cross the VM's file sharing, so
# the worker under test runs here, inside the VM, as root, like the real
# worker. Built and run by test/docker/in-linux.sh from the repo root. Linux
# hosts (CI) run `pnpm --filter @dlh/agent test:docker` directly instead.
FROM docker:29-cli AS docker

FROM node:22-slim
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
RUN npm install -g pnpm@9.12.3
WORKDIR /src
# The store first, from the lockfile alone, so a source change keeps this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@dlh/agent..."
WORKDIR /src/apps/agent
CMD ["pnpm", "test:docker"]

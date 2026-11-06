# dlh-agent-runner: one Agent SDK session per container. Built from the repo
# root by `pnpm agent:image`. It holds no secret: connections are fetched on
# use from the run's socket at /run/dlh/dlh.sock (bin/dlh-credential, bin/gh,
# and the MCP launcher /opt/runner/mcp.js).

# ---- build: bundle the runner, and deploy its runtime dependencies
FROM node:22-slim AS build
RUN npm install -g pnpm@9.12.3
WORKDIR /src
# Download every dependency from the lockfile alone, so this layer stays cached
# until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
# The protocol imports each module's description by path, so the modules too.
RUN pnpm install --offline --frozen-lockfile --filter "@dlh/agent-runner..." --filter "./modules/*..."
RUN pnpm --filter @dlh/agent-runner bundle \
 && pnpm --filter @dlh/agent-runner deploy --prod /out/runner \
 && find /out/runner -mindepth 1 -maxdepth 1 ! -name node_modules ! -name package.json -exec rm -rf {} + \
 && cp packages/agent-runner/dist/main.js packages/agent-runner/dist/mcp.js /out/runner/

# ---- the MCP servers for slack, linear and gdrive connections, pinned
FROM node:22-slim AS mcp
WORKDIR /opt/mcp
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund \
      @zencoderai/slack-mcp-server@0.0.1 \
      @tacticlaunch/mcp-linear@1.4.5 \
      @piotr-agier/google-drive-mcp@2.13.0

# ---- the image
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq python3 python3-venv unzip \
 # gh, from GitHub's apt repository: /usr/bin/gh, behind the wrapper
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 # AWS CLI v2
 && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscli.zip \
 && unzip -q /tmp/awscli.zip -d /tmp \
 && /tmp/aws/install \
 && rm -rf /tmp/aws /tmp/awscli.zip \
 && apt-get purge -y unzip \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9.12.3 \
 && npm cache clean --force

COPY --from=mcp /opt/mcp /opt/mcp
COPY --from=build /out/runner /opt/runner
COPY packages/agent-runner/bin/dlh-credential packages/agent-runner/bin/gh /opt/dlh/bin/

# The wrappers come before the real gh (/usr/bin/gh) on PATH. The root
# filesystem is read-only in a run, so home is the workspace volume.
ENV PATH=/opt/dlh/bin:$PATH \
    HOME=/workspace \
    CLAUDE_CONFIG_DIR=/workspace/.claude \
    GIT_TERMINAL_PROMPT=0 \
    GH_PROMPT_DISABLED=1

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/runner/main.js"]

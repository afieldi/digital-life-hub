# VPS deployment

One Linux VPS runs Postgres, the API (`apps/api`), the agent worker
(`apps/agent`) and the Slack bot (`apps/slack`). The worker starts one `dlh-agent-runner` container per agent
run, on its own network, `dlh-runs`, which can't reach private address space.

```
internal network:  db  <-  api  <-  agent (worker)
                              ^
                              +----  slack (Socket Mode out to Slack)
                                      | /var/run/docker.sock
                                      v
dlh-runs network:                   dlh-run-<id>-<start> containers (public internet only)
```

The worker holds the Docker socket, which is root on the host. It is the only
service that mounts it; the run containers never see it.

## First deploy

Needs Docker with the Compose plugin, `iptables`, git, and Node 22 + pnpm for
the CLI steps (run from a checkout of this repo).

1. Clone the repo and `pnpm install`.
2. `cp deploy/vps/.env.example deploy/vps/.env` and fill in
   `POSTGRES_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `ALLOWED_EMAIL`. Leave `AGENT_WORKER_TOKEN` empty for now (step 9 fills it); set the other two as the next steps say. The Slack tokens and `COMPOSE_PROFILES=slack` come from "The Slack bot" below; leave them out until then.
3. Generate the secrets key: `openssl rand -base64 32` into `AGENT_SECRETS_KEY`.
   It encrypts the connection secrets in `/var/lib/dlh-agent/agent.db`. Back it
   up: without it those secrets can't be read.
4. Create the Gateway keys (below): one into `AI_GATEWAY_API_KEY` (the agent) and a second into `API_AI_GATEWAY_API_KEY` (the API), plus `AI_GATEWAY_DEFAULT_MODEL`.
5. Create the run network and its firewall, as root, with Docker running:
   `sudo sh deploy/vps/runs-firewall.sh`. Then install it to run at every
   boot, before Docker starts, so no run ever starts without the rules:

   ```
   sudo install -m 0755 deploy/vps/runs-firewall.sh /usr/local/sbin/dlh-runs-firewall
   sudo install -m 0644 deploy/vps/dlh-runs-firewall.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now dlh-runs-firewall
   ```

   The script is safe to run again at any time. It refuses a `dlh-runs` made
   another way (see "The run network"), and the worker claims no run unless
   `dlh-runs` is made as the script makes it.
6. Create the data dir: `sudo mkdir -p /var/lib/dlh-agent`.
7. Build the run image: `pnpm agent:image`.
8. Start the database and API first:
   `docker compose -f deploy/vps/docker-compose.yml up -d --build db api`.
   The API migrates the database on start (`MIGRATE_ON_START=1`).
9. Mint the worker token. The CLI runs from the checkout and reaches the
   database through a temporary Compose-network address, so look the db
   container up and use its IP:
   `DB=$(docker inspect -f '{{(index .NetworkSettings.Networks "dlh_internal").IPAddress}}' dlh-db-1)`
   then `DATABASE_URL=postgres://dlh:<POSTGRES_PASSWORD>@$DB:5432/dlh pnpm --filter @dlh/api tokens worker create`.
   It prints `id` and `token` once; put the token in `AGENT_WORKER_TOKEN`.
   (From the host, Docker's bridge IPs are reachable on Linux.)
   Then set `AGENT_WORKER_TOKEN` in `.env`. Revoke with `tokens worker revoke <id>`.
10. Start the worker: `docker compose -f deploy/vps/docker-compose.yml up -d agent`.
11. Add connections (types: github, aws, slack, linear, gdrive, mcp, env). The
    CLI keeps its secrets in the same store as the worker
    (`/var/lib/dlh-agent/agent.db`), encrypted with the same key, so run it with
    the worker's settings and as a user that can write that directory (root,
    since the worker created it). Load them from `.env` rather than typing them,
    so they stay out of the shell history and the process list:

    ```
    set -a; . deploy/vps/.env; set +a
    sudo -E env "PATH=$PATH" API_URL=http://127.0.0.1:8787 pnpm agent connection add slack "<name>"
    ```

    then enable the connection in the hub's Settings.
12. Set up the Slack bot (next section), then start it.
13. Put a TLS reverse proxy (Caddy, nginx) in front of `127.0.0.1:8787`. The API
    is only published on loopback.

## The Slack bot

The bot (`apps/slack`) opens a Socket Mode connection out to Slack, so it needs
no public URL and publishes no port. It reaches the API over the `internal`
network with its own service token.

1. Create a Slack app (api.slack.com/apps) and turn on **Socket Mode**.
2. Give it these scopes:
   - Bot token: `app_mentions:read`, `im:history`, `im:read`, `im:write`,
     `channels:history`, `groups:history`, `chat:write`, `reactions:write`,
     `users:read`, `users.profile:read`.
   - App-level token: `connections:write`.
   - User token: `chat:write` (it sends as you; the outbox uses it in Part 2).
3. Subscribe to the bot events `message.im` and `app_mention`. Turn on
   **Interactivity** (no request URL is needed in Socket Mode; the escalation
   flow posts buttons in Part 2). Under App Home -> Messages tab, enable
   "Allow users to send messages to your app": DMs need it.
4. Have a workspace admin install the app.
5. Copy the three tokens into `deploy/vps/.env`: the app-level token
   (`xapp-...`) as `SLACK_APP_TOKEN`, the bot token (`xoxb-...`) as
   `SLACK_BOT_TOKEN`, the user token (`xoxp-...`) as `SLACK_USER_TOKEN`.
6. Mint the bot's hub token the way step 9 mints the worker's (the API image
   holds no CLI, so run it from the checkout against the database; `$DB` is as
   in step 9):
   `DATABASE_URL=postgres://dlh:<POSTGRES_PASSWORD>@$DB:5432/dlh pnpm --filter @dlh/api tokens slack create`.
   It prints `id` and `token` once; put the token in `HUB_SLACK_TOKEN`. Revoke
   with `tokens slack revoke <id>`.
7. The bot is an opt-in Compose profile, so the rest of the stack runs without
   it. Add `COMPOSE_PROFILES=slack` to `deploy/vps/.env`, then start it:
   `docker compose -f deploy/vps/docker-compose.yml up -d slack` (plain
   `up -d` now includes it too).
8. In the hub, open Settings → Slack and set your Slack user id, so the bot
   knows which DMs are yours. The team and bot ids need no entry: the bot reads
   them from Slack (`auth.test`) at start and whenever it refreshes the
   settings, and they win over any value typed there. They are what tells your
   workspace's people from Slack Connect guests, whom the bot ignores.

To map a coworker to GitHub, the bot reads the user profile field labelled
"GitHub" (needs `users.profile:read`). Add that field to the workspace's
profiles and have people fill it in; the bot takes their login from it.

## AI Gateway key and budget

Runs reach Claude through the Vercel AI Gateway; the key lives only in the
worker (the run containers get a dummy token and talk to the worker's relay).
In the Vercel dashboard, open AI Gateway, create an API key for this host, and
set a monthly budget on it so a runaway run can't spend without bound
(`vercel ai-gateway --help` lists the CLI equivalents). When the budget is hit
the Gateway answers `402` and the run ends with "AI budget reached".

Create a second key, with its own budget, for the API: put it in
`API_AI_GATEWAY_API_KEY`, and set `AI_GATEWAY_DEFAULT_MODEL` to a Gateway model
id. The API uses it for Jev and the Slack bot's coworker answers; without it
those answers are off. Separate keys keep their budgets apart, so chat spend
can't starve runs or the reverse.

## Least privilege for the agent's repos

The agent can push to any repo its GitHub connection reaches. Enable branch
protection on `main` for each such repo (require a PR and review, no direct
pushes, no force pushes) so its work always arrives as a pull request. Give the
connection a token scoped to just those repos.

## Third-party MCP servers

The runner image pins the Slack (`@zencoderai/slack-mcp-server`), Linear
(`@tacticlaunch/mcp-linear`) and Drive (`@piotr-agier/google-drive-mcp`) MCP
servers. They are third-party npm packages that will see the tokens you give
them. Review their source (and the pinned versions) before adding a real token,
or swap the pin in `packages/agent-runner/Dockerfile`.

## The run network

`runs-firewall.sh` adds, for traffic in from the network's bridge, `dlh-runs0`:

- `DOCKER-USER`: drop traffic to `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, `169.254.0.0/16` (cloud metadata) and `100.64.0.0/10`;
  accept established/related replies first.
- `INPUT`: drop anything new addressed to the host itself. Containers reach
  the host (the bridge gateway, where the API is published) without being
  forwarded, so `DOCKER-USER` doesn't see it.

The rules name the bridge, not the subnet, so they need no Docker: the
`dlh-runs-firewall` unit (`--rules-only`) installs them at boot before Docker
starts, and Docker keeps `DOCKER-USER`'s rules when it starts.

The network is created with the bridge name `dlh-runs0` (which the rules
name), `enable_icc=false` (runs can't reach each other; bridge-local traffic
doesn't pass `DOCKER-USER`) and `--ipv6=false`. The script checks an existing
`dlh-runs` for all three and fails if one is off; the worker checks the same
before each claim and claims no run (logging it once) until it's right. To
fix one made another way: stop the worker, `docker network rm dlh-runs`, and
run the script again.

The worker talks to each run over a Unix socket in a bind mount, which is not
network traffic and is unaffected. DNS is not unaffected: Docker's embedded
resolver forwards to the host's upstream resolvers from the container's own
namespace, so an upstream in a blocked range (the AWS VPC resolver
`172.31.0.2` via systemd-resolved, or `169.254.169.254` on GCP/Oracle) would be
dropped. So the worker starts runs with `--dns 1.1.1.1 --dns 9.9.9.9`.

## Upgrading

```
git pull && pnpm install
pnpm agent:image
docker compose -f deploy/vps/docker-compose.yml up -d --build
```

The API applies new migrations on start. Restarting the worker is safe: a run
it was holding is claimed again and resumes. Run
`sudo sh deploy/vps/runs-firewall.sh` again after `docker network rm dlh-runs`,
and reinstall it to `/usr/local/sbin/dlh-runs-firewall` when it changes.

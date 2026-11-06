# VPS deployment

One Linux VPS runs Postgres, the API (`apps/api`) and the agent worker
(`apps/agent`). The worker starts one `dlh-agent-runner` container per agent
run, on its own network, `dlh-runs`, which can't reach private address space.

```
internal network:  db  <-  api  <-  agent (worker)
                                      | /var/run/docker.sock
                                      v
dlh-runs network:                   dlh-run-<id> containers (public internet only)
```

The worker holds the Docker socket, which is root on the host. It is the only
service that mounts it; the run containers never see it.

## First deploy

Needs Docker with the Compose plugin, `iptables`, git, and Node 22 + pnpm for
the CLI steps (run from a checkout of this repo).

1. Clone the repo and `pnpm install`.
2. `cp deploy/vps/.env.example deploy/vps/.env` and fill in
   `POSTGRES_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `ALLOWED_EMAIL`. Leave `AGENT_WORKER_TOKEN` empty for now (step 9 fills it); set the other two as the next steps say.
3. Generate the secrets key: `openssl rand -base64 32` into `AGENT_SECRETS_KEY`.
   It encrypts the connection secrets in `/var/lib/dlh-agent/agent.db`. Back it
   up: without it those secrets can't be read.
4. Create the Gateway key (below) into `AI_GATEWAY_API_KEY`.
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
12. Put a TLS reverse proxy (Caddy, nginx) in front of `127.0.0.1:8787`. The API
    is only published on loopback.

## AI Gateway key and budget

Runs reach Claude through the Vercel AI Gateway; the key lives only in the
worker (the run containers get a dummy token and talk to the worker's relay).
In the Vercel dashboard, open AI Gateway, create an API key for this host, and
set a monthly budget on it so a runaway run can't spend without bound
(`vercel ai-gateway --help` lists the CLI equivalents). When the budget is hit
the Gateway answers `402` and the run ends with "AI budget reached".

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

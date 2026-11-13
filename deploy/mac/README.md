# The agent worker on a Mac

For trying agent runs (such as a pull request review from Slack) against a
local `pnpm dev`. The VPS setup is in [deploy/vps](../vps/README.md).

On a Mac the worker can't run as a plain `pnpm` process. It talks to each run
container over a Unix socket in a mounted folder, and Docker Desktop can't
connect a socket across its Linux VM. So the worker runs in Docker too, as on
the VPS, and keeps its data in `/var/lib/dlh-agent` inside the VM.

## Start it

1. Set up `apps/agent/.env` as for the worker: `API_URL` (your local API,
   such as `http://127.0.0.1:8787`), `AGENT_WORKER_TOKEN`, `AGENT_SECRETS_KEY`
   and `AI_GATEWAY_API_KEY`. The script points the worker at the same API
   through `host.docker.internal`.
2. Run `pnpm dev`, which doesn't start the worker. Don't also run
   `pnpm --filter @dlh/agent dev`: a worker on the Mac claims runs it can't
   finish.
3. Run `pnpm agent:mac`. It:
   - sets the run firewall and makes the `dlh-runs` network inside Docker's
     VM, with `deploy/vps/runs-firewall.sh` in a privileged container;
   - builds the run image (`dlh-agent-runner`) and the worker's;
   - copies `~/.dlh-agent/agent.db` into the worker's store, once, if you
     added connections with the host CLI before;
   - starts the worker.

Docker Desktop forgets the firewall rules when it restarts. The worker comes
back with it and sets them again before it starts.

| Command                           | Does                                            |
| --------------------------------- | ----------------------------------------------- |
| `pnpm agent:mac`                  | Builds and (re)starts the worker                |
| `pnpm agent:mac logs`             | Follows the worker's log                        |
| `pnpm agent:mac connection <...>` | The connection CLI, such as `add github GitHub` |
| `pnpm agent:mac down`             | Stops the worker                                |

The worker runs from its image, so it doesn't reload on code changes: run
`pnpm agent:mac` again after one.

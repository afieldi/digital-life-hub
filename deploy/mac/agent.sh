#!/bin/sh
# The agent worker on a Mac, in Docker Desktop (see deploy/mac/README.md).
#
#   agent.sh [up]               build the images, set the run firewall, start
#   agent.sh connection <args>  the connection CLI, against the worker's store
#   agent.sh logs               follow the worker's log
#   agent.sh down               stop the worker
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
env_file="$root/apps/agent/.env"
compose="docker compose -f $root/deploy/mac/docker-compose.yml"
# Inside Docker's VM, not on the Mac.
data=/var/lib/dlh-agent

if [ ! -f "$env_file" ]; then
  echo "agent.sh: no apps/agent/.env; set the worker up as in deploy/mac/README.md" >&2
  exit 1
fi
# The worker's API_URL names the Mac's loopback; from a container the Mac is
# host.docker.internal.
api_url=$(sed -n 's/^API_URL=//p' "$env_file" | tail -n 1 | tr -d '"'"'")
AGENT_HUB_URL=$(printf '%s' "${api_url:-http://127.0.0.1:8787}" |
  sed -E 's#//(127\.0\.0\.1|localhost)([:/]|$)#//host.docker.internal\2#')
export AGENT_HUB_URL

case "${1:-up}" in
up)
  docker build -q -f "$root/deploy/mac/firewall.Dockerfile" \
    -t dlh-runs-firewall "$root/deploy/vps" >/dev/null
  # The rules, then the dlh-runs network, in the VM.
  docker run --rm --privileged --network host \
    -v /var/run/docker.sock:/var/run/docker.sock dlh-runs-firewall
  echo "Building the run image (dlh-agent-runner)..."
  docker build -q -f "$root/packages/agent-runner/Dockerfile" \
    -t dlh-agent-runner "$root" >/dev/null
  # Once: the connections made with the host CLI (in ~/.dlh-agent) move into
  # the worker's store. An existing store is never replaced.
  if [ -f "$HOME/.dlh-agent/agent.db" ]; then
    docker run --rm --entrypoint sh -v "$data:/data" \
      -v "$HOME/.dlh-agent/agent.db:/src/agent.db:ro" dlh-runs-firewall \
      -c '[ -e /data/agent.db ] || { cp /src/agent.db /data/agent.db && echo "Copied ~/.dlh-agent/agent.db into the worker store."; }'
  fi
  echo "Building and starting the worker..."
  $compose up -d --build
  echo "Worker started; it talks to $AGENT_HUB_URL. Follow it with: pnpm agent:mac logs"
  ;;
connection)
  shift
  $compose run --rm agent pnpm exec tsx src/cli.ts connection "$@"
  ;;
logs) $compose logs -f agent ;;
down) $compose down ;;
*)
  echo "usage: agent.sh [up | connection <args> | logs | down]" >&2
  exit 2
  ;;
esac

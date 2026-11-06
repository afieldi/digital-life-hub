#!/bin/sh
# Runs the Docker tests (test/docker.e2e.test.ts) in a Linux container, for
# Docker Desktop: a host Unix socket bind-mounted into a container can't be
# connected to across Docker's VM (virtiofs), so the worker runs inside the VM
# too, as root, with Docker's socket, like the real worker. Its data dir is a
# path inside the VM (not a shared one), mounted at the same path here, so the
# run containers' mounts of it name the same directory.
#
# Needs the test Postgres (docker compose up -d) and the runner image
# (pnpm agent:image). Extra arguments go to vitest, e.g. -t "grant".
set -eu
root=$(cd "$(dirname "$0")/../../../.." && pwd)
data=/var/lib/dlh-agent-e2e
docker build -q -f "$root/apps/agent/test/docker/Dockerfile" -t dlh-agent-e2e "$root" >/dev/null
exec docker run --rm --init \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$data:$data" -e DLH_E2E_DATA_DIR="$data" \
  -e TEST_DATABASE_URL="${E2E_DATABASE_URL:-postgres://dlh:dlh@host.docker.internal:54329/dlh_test}" \
  --add-host host.docker.internal:host-gateway \
  dlh-agent-e2e pnpm test:docker "$@"

#!/bin/sh
# Creates the `dlh-runs` network the agent's run containers use, and cuts it
# off from private address space: the API, the cloud metadata address
# (169.254.169.254), other containers and the LAN. Public internet stays open
# (the relay, git, MCP servers). Idempotent: run it at boot, after Docker
# starts, and again after any `docker network rm dlh-runs`. Needs root.
#
# Two chains matter:
#   DOCKER-USER  traffic *forwarded* from the bridge (to other networks, the
#                LAN, the metadata address).
#   INPUT        traffic from the bridge to the *host itself* (the bridge
#                gateway and every host address, where the API's published
#                port or any host service listens). Containers reach those
#                without being forwarded, so DOCKER-USER never sees them.
# Not affected: the worker <-> container channel is a Unix socket in a bind
# mount (not network), and DNS: containers on a user-defined bridge ask
# Docker's embedded resolver at 127.0.0.11, inside their own namespace; the
# daemon forwards from the host, so it never crosses this bridge and works
# even when the host's resolver is a private address.
set -eu

NET=dlh-runs
BRIDGE=dlh-runs0
BLOCKED="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10"

if ! docker network inspect "$NET" >/dev/null 2>&1; then
  docker network create --driver bridge \
    --opt "com.docker.network.bridge.name=$BRIDGE" "$NET" >/dev/null
fi

subnet=$(docker network inspect "$NET" --format '{{(index .IPAM.Config 0).Subnet}}')
id=$(docker network inspect "$NET" --format '{{.Id}}')
# A network made by hand may not have the fixed name: Docker names it br-<id>.
iface=$(docker network inspect "$NET" \
  --format '{{index .Options "com.docker.network.bridge.name"}}')
[ -n "$iface" ] || iface="br-$(printf %s "$id" | cut -c1-12)"

# Adds a rule at the top unless it's already there.
ensure() {
  chain=$1
  shift
  iptables -C "$chain" "$@" 2>/dev/null || iptables -I "$chain" 1 "$@"
}

# `-I ... 1` puts each rule above the last, so add the DROPs first and the
# ACCEPT last: the ACCEPT ends up first. Replies to connections that came *to*
# a container (host-initiated) are established, so they still pass.
for range in $BLOCKED; do
  ensure DOCKER-USER -s "$subnet" -d "$range" -j DROP
done
ensure DOCKER-USER -s "$subnet" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# The host itself: nothing new from the bridge. (-s is not enough: INPUT sees
# the interface, which can't be spoofed from inside the container.)
ensure INPUT -i "$iface" -j DROP
ensure INPUT -i "$iface" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

echo "$NET ($iface, $subnet): private ranges and the host are blocked"

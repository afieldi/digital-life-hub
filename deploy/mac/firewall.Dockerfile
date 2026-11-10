# deploy/vps/runs-firewall.sh, for Docker Desktop: run privileged on the host
# network, it sets the run firewall inside Docker's Linux VM, where the run
# containers' bridge is. Built by deploy/mac/agent.sh from deploy/vps.
FROM docker:29-cli
RUN apk add --no-cache iptables
COPY runs-firewall.sh /runs-firewall.sh
ENTRYPOINT ["sh", "/runs-firewall.sh"]

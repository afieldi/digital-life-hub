import { useModuleApi, useModuleWrite } from "@dlh/client";
import {
  Caption,
  Checkbox,
  EmptyState,
  QueryState,
  SectionCard,
} from "@dlh/ui";
import { useQuery } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import type { AgentRouter } from "../server";

const KEYS = [
  ["agent", "settings"],
  ["agent", "connections"],
] as const;
const WRITE = { queryKeys: KEYS, conflictMessage: "Changed since" } as const;

/** Which live connections a run for a coworker's request starts with. */
function CoworkerConnections() {
  const api = useModuleApi<AgentRouter>("agent");
  const write = useModuleWrite(WRITE);
  const settings = useQuery({
    queryKey: ["agent", "settings"],
    queryFn: () => api.settings.query({}),
  });
  const connections = useQuery({
    queryKey: ["agent", "connections"],
    queryFn: () => api.connections.query({}),
  });
  const live =
    connections.data?.connections.filter((c) => c.disabledAt === null) ?? [];
  const chosen = settings.data?.coworkerConnectionIds ?? [];

  const toggle = (id: string, on: boolean) => {
    const ids = on ? [...chosen, id] : chosen.filter((x) => x !== id);
    void write({
      op: "agent.setSettings",
      summary: "Coworker connections saved",
      verb: "save the coworker connections",
      call: () => api.setSettings.mutate({ coworkerConnectionIds: ids }),
    });
  };

  return (
    <QueryState
      query={connections}
      errorTitle="Couldn't load connections"
      isEmpty={live.length === 0}
      empty={<EmptyState icon={Plug} title="No connections yet" />}
    >
      {() => (
        <div className="flex flex-col">
          <Caption>
            A coworker's request given to the agent starts with these, in place
            of the default set.
          </Caption>
          {live.map((c) => (
            <Checkbox
              key={c.id}
              isSelected={chosen.includes(c.id)}
              isDisabled={!settings.data}
              onChange={(on) => toggle(c.id, on)}
            >
              {`${c.name} (${c.type})`}
            </Checkbox>
          ))}
        </div>
      )}
    </QueryState>
  );
}

/** Settings → Agent. */
export function AgentSettings() {
  return (
    <SectionCard title="Connections for coworkers' requests">
      <CoworkerConnections />
    </SectionCard>
  );
}

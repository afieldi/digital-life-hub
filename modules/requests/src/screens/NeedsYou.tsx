import { Caption, GlassPanel, ListGroup } from "@dlh/ui";
import { useState } from "react";
import type { RequestRow } from "../schema";
import { useOpenRequests } from "./api";
import { MakeTaskForm } from "./MakeTaskForm";
import { useOutcomes } from "./outcomes";
import { OpenRequestRow, type OpenRowHandlers } from "./RequestRowView";

/** How many of the oldest open requests the widget lists. */
const SHOWN = 3;

/**
 * Home's "Needs you": the open count and the three oldest open requests,
 * each with the same outcomes (or own actions) as on Open. Shows nothing
 * until there is something waiting, and while loading or failed.
 */
export function NeedsYou() {
  const list = useOpenRequests();
  const outcomes = useOutcomes();
  const [making, setMaking] = useState<RequestRow | null>(null);
  const items = list.data?.items ?? [];
  if (items.length === 0) return null;

  const now = new Date();
  const handlers: OpenRowHandlers = {
    onMakeTask: setMaking,
    onResolve: (row, outcome) => void outcomes.resolve(row, outcome),
    onAction: (row, action) => void outcomes.act(row, action),
  };

  return (
    <>
      <GlassPanel level="panel" className="flex flex-col gap-0.5 p-2.5">
        <ListGroup
          label="Needs you"
          action={<Caption>{items.length} open</Caption>}
        >
          {items.slice(0, SHOWN).map((row) => (
            <OpenRequestRow
              key={row.id}
              row={row}
              now={now}
              handlers={handlers}
            />
          ))}
        </ListGroup>
      </GlassPanel>
      {making ? (
        <MakeTaskForm
          request={making}
          onCancel={() => setMaking(null)}
          onSubmit={(params) => {
            setMaking(null);
            void outcomes.makeTask(making, params);
          }}
        />
      ) : null}
    </>
  );
}

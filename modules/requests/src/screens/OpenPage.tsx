import {
  Button,
  EmptyState,
  GlassPanel,
  KeyHints,
  ListGroup,
  Skeleton,
} from "@dlh/ui";
import { CircleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { useOpenRequests } from "./api";
import { useMakeTaskForm } from "./MakeTaskForm";
import { useOutcomes } from "./outcomes";
import { QueueHeader } from "./QueueHeader";
import { OpenRequestRow, type OpenRowHandlers } from "./RequestRowView";

/**
 * Open (`/queue`): what is waiting on you, oldest first. Resolving a row
 * takes it out, with Undo in the toast.
 */
export function OpenPage() {
  const list = useOpenRequests();
  const outcomes = useOutcomes();
  const makeTask = useMakeTaskForm(outcomes);
  const now = new Date();
  const handlers: OpenRowHandlers = {
    onMakeTask: makeTask.start,
    onResolve: (row, outcome) => outcomes.resolve(row, outcome),
    onAction: (row, action) => outcomes.act(row, action),
  };

  const items = list.data?.items ?? [];
  let content: ReactNode;
  if (list.isPending) {
    content = <Skeleton lines={5} />;
  } else if (list.isError) {
    content = (
      <EmptyState
        icon={CircleAlert}
        title="Couldn't load the queue"
        action={
          <Button variant="glass" onPress={() => void list.refetch()}>
            Retry
          </Button>
        }
      />
    );
  } else if (items.length === 0) {
    content = <EmptyState icon={Inbox} title="Nothing waiting on you" />;
  } else {
    content = (
      <ListGroup label={list.data.heading} count={items.length}>
        {items.map((row) => (
          <OpenRequestRow
            key={row.id}
            row={row}
            now={now}
            handlers={handlers}
          />
        ))}
      </ListGroup>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 pt-8 pb-[150px]">
      <QueueHeader current="/queue" />
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-label="Open requests"
          data-request-list
          tabIndex={-1}
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-4"
        >
          <GlassPanel level="panel" className="flex flex-col gap-0.5 p-2.5">
            {content}
          </GlassPanel>
        </section>
        <aside aria-label="Keys" className="flex flex-[1_1_280px] flex-col">
          <KeyHints
            hints={[
              { keys: ["T"], label: "make task" },
              { keys: ["H"], label: "handled" },
              { keys: ["N"], label: "not for me" },
            ]}
          />
        </aside>
      </div>
      {makeTask.form}
    </div>
  );
}

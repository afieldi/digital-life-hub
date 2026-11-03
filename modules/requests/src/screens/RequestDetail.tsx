import { useOpenExternal, useRecordView } from "@dlh/client";
import {
  Button,
  Caption,
  EmptyState,
  SidePanel,
  Skeleton,
  toast,
} from "@dlh/ui";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, ExternalLink } from "lucide-react";
import { useState } from "react";
import { ageLabel } from "../age";
import { requestKeys, useRequestsApi } from "./api";
import { MakeTaskForm } from "./MakeTaskForm";
import { useOutcomes } from "./outcomes";
import {
  OUTCOME_LABELS,
  OutcomeButtons,
  OutcomeChip,
  SourceGlyph,
  senderOf,
} from "./RequestRowView";

const received = (at: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(at));

/** The link to open, when it is a web link; `file` only takes those. */
function webLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The Detail panel (`/queue/$id`): sender, when it came, the full body, a
 * link to where it came from, and the outcomes. A resolved request shows its
 * outcome (and task) with Reopen instead. Records the view.
 */
export function RequestDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  useRecordView(id);
  const requests = useRequestsApi();
  const outcomes = useOutcomes();
  const openExternal = useOpenExternal();
  const [making, setMaking] = useState(false);
  const detail = useQuery({
    queryKey: requestKeys.get(id),
    queryFn: () => requests.get.query({ id }),
  });

  const data = detail.data;
  if (!data) {
    return (
      <SidePanel title="Request" onClose={onClose}>
        {detail.isError ? (
          <EmptyState
            icon={CircleAlert}
            title="Couldn't load the request"
            action={
              <Button variant="glass" onPress={() => void detail.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <Skeleton lines={6} />
        )}
      </SidePanel>
    );
  }

  const { request, task } = data;
  const url = webLink(request.sourceUrl);
  return (
    <SidePanel title={request.title} onClose={onClose}>
      <div className="flex items-center gap-2">
        <SourceGlyph source={request.source} />
        <span>{senderOf(request)}</span>
      </div>
      <Caption>
        Received {received(request.receivedAt)} ·{" "}
        {ageLabel(request.receivedAt, new Date())}
      </Caption>
      {request.body ? (
        <p className="whitespace-pre-wrap">{request.body}</p>
      ) : null}
      {url ? (
        <div>
          <Button
            variant="glass"
            onPress={() =>
              void openExternal(url).catch(() =>
                toast("Couldn't open the link", { tone: "error" }),
              )
            }
          >
            <ExternalLink aria-hidden="true" size={16} />
            {request.source === "slack" ? "Open in Slack" : "Open original"}
          </Button>
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {request.outcome ? (
          <>
            <Caption>Resolved as {OUTCOME_LABELS[request.outcome]}</Caption>
            {request.outcome === "task" ? (
              <OutcomeChip outcome="task" task={task} />
            ) : null}
            <Button
              variant="glass"
              onPress={() => void outcomes.reopen(request)}
            >
              Reopen
            </Button>
          </>
        ) : (
          <OutcomeButtons
            row={request}
            handlers={{
              onMakeTask: () => setMaking(true),
              onResolve: (row, outcome) => void outcomes.resolve(row, outcome),
              onAction: (row, action) => void outcomes.act(row, action),
            }}
          />
        )}
      </div>
      {making ? (
        <MakeTaskForm
          request={request}
          onCancel={() => setMaking(false)}
          onSubmit={(params) => {
            setMaking(false);
            void outcomes.makeTask(request, params);
          }}
        />
      ) : null}
    </SidePanel>
  );
}

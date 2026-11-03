import { Button, Chip, EmptyState, GlassPanel, Skeleton } from "@dlh/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CircleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { outcome as outcomeSchema } from "../schema";
import { requestKeys, useRequestsApi } from "./api";
import { parseQueueSearch, QueueHeader, type QueueSearch } from "./QueueHeader";
import { OUTCOME_LABELS, ResolvedRequestRow } from "./RequestRowView";

/**
 * Resolved (`/queue/resolved`): the last 30 days, newest first, each with its
 * outcome. Filter chips narrow it to one outcome (`?outcome=` in the URL).
 */
export function ResolvedPage({ search: given }: { search?: QueueSearch }) {
  const fromUrl = useSearch({ strict: false });
  const search = given ?? parseQueueSearch(fromUrl);
  const requests = useRequestsApi();
  const navigate = useNavigate();
  const outcome = search.outcome;

  const resolved = useInfiniteQuery({
    queryKey: requestKeys.resolved(outcome),
    queryFn: ({ pageParam }) =>
      requests.resolved.query({ outcome, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = resolved.data?.pages.flatMap((p) => p.rows) ?? [];
  const now = new Date();

  let list: ReactNode;
  if (resolved.isPending) {
    list = <Skeleton lines={5} />;
  } else if (resolved.isError) {
    list = (
      <EmptyState
        icon={CircleAlert}
        title="Couldn't load the queue"
        action={
          <Button variant="glass" onPress={() => void resolved.refetch()}>
            Retry
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    list = <EmptyState icon={Inbox} title="Nothing resolved yet" />;
  } else {
    list = (
      <>
        {rows.map(({ task, ...row }) => (
          <ResolvedRequestRow key={row.id} row={row} task={task} now={now} />
        ))}
        {resolved.hasNextPage ? (
          <Button
            variant="ghost"
            isDisabled={resolved.isFetchingNextPage}
            onPress={() => void resolved.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 pt-8 pb-[150px]">
      <QueueHeader current="/queue/resolved" search={search} />
      <section
        aria-label="Resolved requests"
        className="flex min-w-0 flex-col gap-4"
      >
        <fieldset
          aria-label="Filter by outcome"
          className="flex flex-wrap items-center gap-2"
        >
          {outcome ? (
            <Chip
              kind="type"
              onRemove={() =>
                void navigate({ to: "/queue/resolved", search: {} })
              }
              removeLabel={`Remove filter: ${OUTCOME_LABELS[outcome]}`}
            >
              {OUTCOME_LABELS[outcome]}
            </Chip>
          ) : (
            outcomeSchema.options.map((o) => (
              <Chip key={o} kind="type" href={`/queue/resolved?outcome=${o}`}>
                {OUTCOME_LABELS[o]}
              </Chip>
            ))
          )}
        </fieldset>
        <GlassPanel level="panel" className="flex flex-col gap-0.5 p-2.5">
          {list}
        </GlassPanel>
      </section>
    </div>
  );
}

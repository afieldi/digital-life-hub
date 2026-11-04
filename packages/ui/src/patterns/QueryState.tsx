import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../primitives/Button";
import { Skeleton } from "../primitives/Skeleton";
import { EmptyState } from "./EmptyState";

/** What QueryState reads of a query: TanStack Query's result has these. */
export type QueryLike = {
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
};

/**
 * A screen's data in its states: a skeleton while `query` loads; on failure,
 * `errorTitle` ("Couldn't load tasks") with Retry; `empty` when it loaded but
 * `isEmpty`; else what `children` renders (called only then, so it can read
 * the data).
 */
export function QueryState({
  query,
  errorTitle,
  isEmpty = false,
  empty,
  lines = 5,
  children,
}: {
  query: QueryLike;
  errorTitle: string;
  isEmpty?: boolean;
  empty?: ReactNode;
  /** Skeleton lines while loading. */
  lines?: number;
  children: () => ReactNode;
}) {
  if (query.isPending) return <Skeleton lines={lines} />;
  if (query.isError) {
    return (
      <EmptyState
        icon={CircleAlert}
        title={errorTitle}
        action={
          <Button variant="glass" onPress={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (isEmpty) return <>{empty}</>;
  return <>{children()}</>;
}

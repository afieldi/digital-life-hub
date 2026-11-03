import { Breadcrumb, PageHeader, ViewTabs } from "@dlh/ui";
import { useEffect } from "react";
import type { Outcome } from "../schema";
import { useOpenRequests } from "./api";

export type QueueListPath = "/queue" | "/queue/resolved";
export type QueueSearch = { outcome?: Outcome };

const OUTCOMES = new Set<string>(["task", "handled", "not_for_me"]);

/** Resolved's view state in the URL: `?outcome=handled`; anything else is dropped. */
export function parseQueueSearch(raw: Record<string, unknown>): QueueSearch {
  return typeof raw.outcome === "string" && OUTCOMES.has(raw.outcome)
    ? { outcome: raw.outcome as Outcome }
    : {};
}

/** The list Detail opened over, so closing it goes back there. */
const OPEN = { path: "/queue", search: {} } as const;
let last: { path: QueueListPath; search: QueueSearch } = OPEN;
export const lastQueueList = () => last;

/** The top of both Queue lists: breadcrumb, "Queue", and the Open · N / Resolved tabs. */
export function QueueHeader({
  current,
  search = {},
}: {
  current: QueueListPath;
  search?: QueueSearch;
}) {
  const searchText = JSON.stringify(search);
  useEffect(() => {
    last = { path: current, search: JSON.parse(searchText) };
    // Gone from the lists (not just into Detail, which reads this while
    // rendering, first): a request opened from elsewhere shows over Open.
    return () => {
      last = OPEN;
    };
  }, [current, searchText]);
  const open = useOpenRequests();
  const count = open.data?.items.length;
  return (
    <>
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          current === "/queue"
            ? { label: "Queue" }
            : { label: "Queue", href: "/queue" },
          ...(current === "/queue" ? [] : [{ label: "Resolved" }]),
        ]}
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="Queue" />
        <ViewTabs
          label="Queue views"
          tabs={[
            {
              label: count === undefined ? "Open" : `Open · ${count}`,
              href: "/queue",
              current: current === "/queue",
            },
            {
              label: "Resolved",
              href: "/queue/resolved",
              current: current === "/queue/resolved",
            },
          ]}
        />
      </div>
    </>
  );
}

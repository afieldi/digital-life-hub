import { useOpenRequests } from "./api";

/** Queue's nav badge: how many requests are open, or nothing at 0. */
export function OpenCount() {
  const count = useOpenRequests().data?.items.length ?? 0;
  return count > 0 ? count : null;
}

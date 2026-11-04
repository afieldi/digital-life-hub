/**
 * Writes to one item run one after another, from whichever screen or ⌘K, so a
 * quick second change goes out with the version the first one wrote.
 */
const queues = new Map<string, Promise<void>>();

/** The newest version a write of ours got back, per item. */
const versions = new Map<string, string>();

/** `seen` (what a cache holds), unless one of our writes has since moved past it. */
function freshest(id: string, seen: string): string {
  const ours = versions.get(id);
  return ours && ours > seen ? ours : seen;
}

function noteVersion(id: string, updatedAt: string) {
  const ours = versions.get(id);
  if (!ours || updatedAt > ours) versions.set(id, updatedAt);
}

/** Runs `run` once every write already queued for `ids` has settled; later writes wait for it. */
function enqueue<T>(ids: readonly string[], run: () => Promise<T>): Promise<T> {
  const before = ids.map((id) => queues.get(id) ?? Promise.resolve());
  const next = Promise.all(before).then(run);
  const settled = next.then(
    () => {},
    () => {},
  );
  for (const id of ids) queues.set(id, settled);
  void settled.then(() => {
    for (const id of ids) if (queues.get(id) === settled) queues.delete(id);
  });
  return next;
}

/** A write's result as the item it changed: an item, or an operation's `{ result }`. */
function updatedAtIn(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  if ("updatedAt" in result && typeof result.updatedAt === "string") {
    return result.updatedAt;
  }
  return "result" in result ? updatedAtIn(result.result) : undefined;
}

/**
 * Runs `run` for item `id` behind that item's other writes, with the newest
 * version we know of (the cache's `seen`, or a later one our writes got back),
 * and remembers the version its result carries (`versionOf`, by default its
 * `updatedAt`).
 */
export function queueVersioned<T>(
  id: string,
  seen: string,
  run: (expectedUpdatedAt: string) => Promise<T>,
  versionOf: (result: T) => string | undefined = updatedAtIn,
): Promise<T> {
  return enqueue([id], async () => {
    const result = await run(freshest(id, seen));
    const version = versionOf(result);
    if (version) noteVersion(id, version);
    return result;
  });
}

/**
 * One write to several items (e.g. reschedule all overdue): behind each one's
 * queued writes, with each one's newest version, remembering the versions the
 * result reports (`versionsOf`).
 */
export function queueVersionedMany<T>(
  items: readonly { id: string; seen: string }[],
  run: (versions: { id: string; expectedUpdatedAt: string }[]) => Promise<T>,
  versionsOf: (result: T) => readonly { id: string; updatedAt: string }[],
): Promise<T> {
  return enqueue(
    items.map((i) => i.id),
    async () => {
      const result = await run(
        items.map((i) => ({
          id: i.id,
          expectedUpdatedAt: freshest(i.id, i.seen),
        })),
      );
      for (const v of versionsOf(result)) noteVersion(v.id, v.updatedAt);
      return result;
    },
  );
}

export type ChangeBus = {
  /** Notifies every subscriber once with the distinct ids, in order of first appearance. */
  publish(ids: Iterable<string>): void;
  subscribe(fn: (ids: string[]) => void): () => void;
  /** Subscriber count. */
  size(): number;
};

export function createChangeBus(): ChangeBus {
  const subscribers = new Set<(ids: string[]) => void>();
  return {
    publish(ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return;
      for (const fn of [...subscribers]) {
        // One failing subscriber must not starve the rest or fail the write.
        try {
          fn(unique);
        } catch (err) {
          console.error("change bus subscriber failed", err);
        }
      }
    },
    subscribe(fn) {
      // Wrap so subscribing the same function twice yields independent entries.
      const entry = (ids: string[]) => fn(ids);
      subscribers.add(entry);
      return () => {
        subscribers.delete(entry);
      };
    },
    size: () => subscribers.size,
  };
}

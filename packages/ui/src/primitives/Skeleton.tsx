export type SkeletonProps = { lines?: number; className?: string };

/** Placeholder bars shown while content loads. */
export function Skeleton({ lines = 3, className }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={`flex flex-col gap-2.5 ${className ?? ""}`}
    >
      {Array.from({ length: lines }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder bars
          key={i}
          aria-hidden="true"
          className={`h-3.5 rounded-full bg-white/12 motion-safe:animate-pulse ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

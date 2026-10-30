import { EmptyState, GlassPanel } from "@dlh/ui";
import { LayoutGrid } from "lucide-react";

export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}

export function Home() {
  const now = new Date();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
      <GlassPanel
        level="panel"
        data-testid="greeting"
        className="flex flex-col gap-1 p-8"
      >
        <h1 className="font-serif text-[40px] leading-tight text-ink-primary">
          {greetingFor(now)}
        </h1>
        <p className="text-[15px] text-ink-tertiary">
          {now.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </GlassPanel>
      <GlassPanel level="card">
        <EmptyState
          icon={LayoutGrid}
          title="Your modules will appear here"
          body="Tasks, notes, projects and more show up on Home as they are added."
        />
      </GlassPanel>
    </div>
  );
}

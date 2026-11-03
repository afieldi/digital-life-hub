import { useHomeWidgets } from "@dlh/client";
import { EmptyState, GlassPanel, PageHeader } from "@dlh/ui";
import { LayoutGrid } from "lucide-react";

export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}

export function HomePage() {
  const now = new Date();
  const widgets = useHomeWidgets();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
      <GlassPanel level="panel" data-testid="greeting" className="p-8">
        <PageHeader
          title={greetingFor(now)}
          subtitle={now.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        />
      </GlassPanel>
      {widgets.length === 0 ? (
        <GlassPanel level="card">
          <EmptyState
            icon={LayoutGrid}
            title="Your modules will appear here"
            body="Tasks, notes, projects and more show up on Home as they are added."
          />
        </GlassPanel>
      ) : (
        widgets.map(({ id, component: Widget }) => <Widget key={id} />)
      )}
    </div>
  );
}

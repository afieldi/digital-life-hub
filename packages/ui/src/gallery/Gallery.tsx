import { getStoryGroups } from "./registry";

export type { Story } from "./registry";
export { registerStories } from "./registry";

// Story files self-register on import; the glob means new *.stories.tsx files
// appear without editing a central list.
import.meta.glob("./stories/*.stories.tsx", { eager: true });

export function Gallery({ filter }: { filter?: string }) {
  const groups = getStoryGroups();
  return (
    <div className="min-h-screen bg-app p-8 font-sans text-white">
      {groups.map(({ group, stories }) => {
        const visible = stories.filter(
          (s) => !filter || s.id.includes(filter) || s.title.includes(filter),
        );
        if (visible.length === 0) return null;
        return (
          <section key={group} className="mb-10">
            <h2 className="mb-4 text-sm uppercase tracking-widest opacity-60">
              {group}
            </h2>
            <div className="flex flex-wrap items-start gap-6">
              {visible.map((s) => (
                <div key={s.id} className="inline-block">
                  <p className="mb-2 text-xs opacity-60">{s.title}</p>
                  <div data-story={s.id} className="inline-block p-4">
                    {s.render()}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

import { type SceneVariant, Tab, TabList, TabPanel, Tabs } from "@dlh/ui";
import { useSceneOverride } from "../shell/sceneOverride";

type Choice = "auto" | SceneVariant;

const choices: { id: Choice; label: string; description: string }[] = [
  {
    id: "auto",
    label: "Automatic",
    description: "The scene follows the time of day.",
  },
  {
    id: "morning",
    label: "Morning",
    description: "Always show the morning scene.",
  },
  { id: "dusk", label: "Dusk", description: "Always show the dusk scene." },
  { id: "night", label: "Night", description: "Always show the night scene." },
];

export function Settings() {
  const { override, setOverride } = useSceneOverride();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
      <h1 className="font-serif text-[40px] leading-tight text-ink-primary">
        Settings
      </h1>
      <section className="glass-panel flex flex-col gap-3 p-6">
        <h2 id="scene-heading" className="text-[17px] font-semibold">
          Scene
        </h2>
        <Tabs
          aria-labelledby="scene-heading"
          selectedKey={override ?? "auto"}
          onSelectionChange={(key) =>
            setOverride(key === "auto" ? null : (key as SceneVariant))
          }
        >
          <TabList aria-label="Scene">
            {choices.map((c) => (
              <Tab key={c.id} id={c.id}>
                {c.label}
              </Tab>
            ))}
          </TabList>
          {choices.map((c) => (
            <TabPanel
              key={c.id}
              id={c.id}
              className="text-sm text-ink-tertiary"
            >
              {c.description}
            </TabPanel>
          ))}
        </Tabs>
      </section>
    </div>
  );
}

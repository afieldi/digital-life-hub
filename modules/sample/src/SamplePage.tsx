import { Button, EmptyState, SectionCard, toast } from "@dlh/ui";
import { FlaskConical } from "lucide-react";

export function SamplePage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
      <h1 className="sr-only">Sample</h1>
      <SectionCard title="Sample module">
        <EmptyState
          icon={FlaskConical}
          title="Nothing here yet"
          body="This module only proves that a manifest adds a page, a Dock item and a command."
          action={
            <Button onPress={() => toast("Hello from Sample")}>
              Say hello
            </Button>
          }
        />
      </SectionCard>
    </div>
  );
}

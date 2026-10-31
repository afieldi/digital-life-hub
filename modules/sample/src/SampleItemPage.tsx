import { useCoreApi, useRecordView } from "@dlh/client";
import { Button, EmptyState, SectionCard, TextField, toast } from "@dlh/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { useState } from "react";

/** An unsaved edit, remembering the version it started from so a save made after someone else's change conflicts. */
type Draft = { text: string; baseUpdatedAt: string };

export function SampleItemPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const core = useCoreApi();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  useRecordView(id);

  const key = ["sample", "item", id];
  const itemQuery = useQuery({
    queryKey: key,
    queryFn: () => core.items.get.query({ id }),
  });
  const item = itemQuery.data;

  const rename = useMutation({
    mutationFn: (d: Draft) =>
      core.items.rename.mutate({
        id,
        title: d.text,
        expectedUpdatedAt: d.baseUpdatedAt,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(key, updated);
      setDraft(null);
    },
    onError: async (err) => {
      if ((err as { data?: { code?: string } }).data?.code === "CONFLICT") {
        toast("Changed elsewhere — reloaded");
        setDraft(null);
        await queryClient.invalidateQueries({ queryKey: key });
      } else {
        toast("Could not save the title", { tone: "error" });
      }
    },
  });

  if (!item) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
        {itemQuery.isError ? (
          <EmptyState icon={FlaskConical} title="This item is not available" />
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
      <h1 className="text-2xl font-semibold">{item.title}</h1>
      <SectionCard title="Rename">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft?.text.trim()) rename.mutate(draft);
          }}
        >
          <TextField
            className="flex-1"
            label="Title"
            value={draft?.text ?? item.title}
            onChange={(text) =>
              setDraft({
                text,
                baseUpdatedAt: draft?.baseUpdatedAt ?? item.updatedAt,
              })
            }
          />
          <Button
            type="submit"
            variant="solid"
            isDisabled={rename.isPending || !draft?.text.trim()}
          >
            Save
          </Button>
        </form>
      </SectionCard>
    </div>
  );
}

import { useCoreApi, useModuleApi } from "@dlh/client";
import {
  Button,
  EmptyState,
  ItemRow,
  SectionCard,
  TextField,
  toast,
} from "@dlh/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import type { SampleRouter } from "./server";

export function SamplePage() {
  const core = useCoreApi();
  const sample = useModuleApi<SampleRouter>("sample");
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const list = useQuery({
    queryKey: ["sample", "list"],
    queryFn: () => core.items.list.query({ types: ["sample"] }),
  });
  const create = useMutation({
    mutationFn: (t: string) => sample.create.mutate({ title: t.trim() }),
    onError: () => toast("Could not create the item", { tone: "error" }),
    onSuccess: async () => {
      setTitle("");
      await queryClient.invalidateQueries({ queryKey: ["sample", "list"] });
    },
  });
  const items = list.data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
      <h1 className="sr-only">Sample</h1>
      <SectionCard title="New sample item">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate(title);
          }}
        >
          <TextField
            className="flex-1"
            label="New sample item"
            value={title}
            onChange={setTitle}
          />
          <Button
            type="submit"
            variant="solid"
            isDisabled={create.isPending || !title.trim()}
          >
            Create
          </Button>
        </form>
      </SectionCard>
      <SectionCard title="Sample items">
        {items.length === 0 && list.isSuccess ? (
          <EmptyState
            icon={FlaskConical}
            title="Nothing here yet"
            body="Create a sample item above."
          />
        ) : (
          <div className="flex flex-col">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                title={item.title}
                href={`/sample/${item.id}`}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

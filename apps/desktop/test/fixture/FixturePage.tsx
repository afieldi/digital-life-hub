import type { FixtureRouter } from "@dlh/api/testing";
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

/** The fixture module's list: creates through `fixture.create`, lists through `items.list`. */
export function FixturePage() {
  const core = useCoreApi();
  const fixture = useModuleApi<FixtureRouter>("fixture");
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const list = useQuery({
    queryKey: ["fixture", "list"],
    queryFn: () => core.items.list.query({ types: ["fixture"] }),
  });
  const create = useMutation({
    mutationFn: (t: string) => fixture.create.mutate({ title: t.trim() }),
    onError: () => toast("Could not create the item", { tone: "error" }),
    onSuccess: async () => {
      setTitle("");
      await queryClient.invalidateQueries({ queryKey: ["fixture", "list"] });
    },
  });
  const items = list.data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
      <h1 className="sr-only">Fixture</h1>
      <SectionCard title="New fixture item">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate(title);
          }}
        >
          <TextField
            className="flex-1"
            label="New fixture item"
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
      <SectionCard title="Fixture items">
        {items.length === 0 && list.isSuccess ? (
          <EmptyState
            icon={FlaskConical}
            title="Nothing here yet"
            body="Create a fixture item above."
          />
        ) : (
          <div className="flex flex-col">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                title={item.title}
                href={`/fixture/${item.id}`}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

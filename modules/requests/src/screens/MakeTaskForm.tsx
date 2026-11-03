import { useCoreApi } from "@dlh/client";
import { formFields } from "@dlh/core";
import { OperationForm } from "@dlh/ui";
import { makeTaskParams, requestOps } from "../operations";
import type { RequestRow } from "../schema";
import { deviceTimeZone } from "./api";
import type { MakeTaskParams } from "./outcomes";

const fields = formFields(makeTaskParams);

/**
 * Make task's form, as ⌘K shows it: title from the request, its details as
 * notes, due and priority empty. Only what was changed is sent; the server
 * fills in the rest from the request.
 */
export function MakeTaskForm({
  request,
  onSubmit,
  onCancel,
}: {
  request: RequestRow;
  onSubmit: (params: MakeTaskParams) => void;
  onCancel: () => void;
}) {
  const core = useCoreApi();
  const initial = { title: request.title, notes: request.body ?? undefined };
  return (
    <OperationForm
      title={requestOps.makeTask.label}
      fields={fields}
      initial={initial}
      timeZone={deviceTimeZone()}
      search={(query, types) => core.search.query({ query, types })}
      onCancel={onCancel}
      onSubmit={(values) => {
        const changed = Object.fromEntries(
          Object.entries(values).filter(
            ([name, v]) => v !== initial[name as keyof typeof initial],
          ),
        );
        onSubmit(makeTaskParams.parse(changed));
      }}
    />
  );
}

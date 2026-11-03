import { useCoreApi } from "@dlh/client";
import { formFields } from "@dlh/core";
import { OperationForm } from "@dlh/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { makeTaskParams, requestOps } from "../operations";
import type { RequestRow } from "../schema";
import { deviceTimeZone } from "./api";
import type { MakeTaskParams, useOutcomes } from "./outcomes";

const fields = formFields(makeTaskParams);

/**
 * Make task's form, as ⌘K shows it: title from the request, its details as
 * notes, due and priority empty. Only what was changed is sent; the server
 * fills in the rest from the request. Notes cleared are sent as "", so the
 * task has none rather than the request's details.
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
        // The form leaves an emptied field out, which the server would fill.
        if (initial.notes !== undefined && values.notes === undefined) {
          changed.notes = "";
        }
        onSubmit(makeTaskParams.parse(changed));
      }}
    />
  );
}

/**
 * Make task on a list of rows: `start` opens the form for a row, and `form`
 * is the form to render. Once the task is made, focus goes where the row said
 * (the next row), as it does after Handled.
 */
export function useMakeTaskForm(outcomes: ReturnType<typeof useOutcomes>): {
  start: (row: RequestRow, refocus?: HTMLElement | null) => void;
  form: ReactNode;
} {
  const [making, setMaking] = useState<{
    row: RequestRow;
    refocus: HTMLElement | null;
  } | null>(null);
  const refocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (making) return;
    // After the form is gone, so its focus scope doesn't take focus back.
    const el = refocus.current;
    refocus.current = null;
    if (el?.isConnected) el.focus();
  }, [making]);
  const form = making ? (
    <MakeTaskForm
      request={making.row}
      onCancel={() => setMaking(null)}
      onSubmit={(params) => {
        refocus.current = making.refocus;
        setMaking(null);
        void outcomes.makeTask(making.row, params);
      }}
    />
  ) : null;
  return {
    start: (row, to = null) => setMaking({ row, refocus: to }),
    form,
  };
}

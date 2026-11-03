import { deviceTimeZone, type Item } from "@dlh/core";
import { CaptureField, Kbd, TypeTile } from "@dlh/ui";
import { type Ref, useMemo, useState } from "react";
import { parseTaskInput } from "../capture";
import { taskOps } from "../operations";
import type { Due } from "../schema";
import { useTasksApi, useTaskWrite } from "./api";

export type QuickAddProps = {
  /** Used when the text names no date, e.g. the day an Add button sits on. */
  defaultDue?: Due;
  onCreated?: (task: Item) => void;
  inputRef?: Ref<HTMLInputElement>;
};

/** One line to add a task: marks the date and priority it read as you type. */
export function QuickAdd({ defaultDue, onCreated, inputRef }: QuickAddProps) {
  const tasks = useTasksApi();
  const write = useTaskWrite();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const parsed = useMemo(
    () => parseTaskInput(text, { now: new Date(), timeZone: deviceTimeZone() }),
    [text],
  );

  const submit = async () => {
    if (pending || !parsed.title) return;
    const input = {
      title: parsed.title,
      ...((parsed.due ?? defaultDue) ? { due: parsed.due ?? defaultDue } : {}),
      ...(parsed.priority ? { priority: parsed.priority } : {}),
    };
    setPending(true);
    const created = await write({
      op: taskOps.create.id,
      summary: taskOps.create.summary(input),
      verb: "add the task",
      call: () => tasks.create.mutate(input),
    });
    setPending(false);
    if (created) {
      setText("");
      onCreated?.(created);
    }
  };

  return (
    <CaptureField
      label="Add a task"
      value={text}
      onChange={setText}
      onSubmit={() => void submit()}
      highlights={parsed.spans}
      placeholder="Add a task… try “Call the bank Friday 9am !”"
      leading={<TypeTile type="task" size={30} />}
      trailing={<Kbd keys={["↵"]} />}
      inputRef={inputRef}
    />
  );
}

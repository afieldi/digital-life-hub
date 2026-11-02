import { Checkbox, Flag, ItemRow } from "@dlh/ui";
import type { Day } from "../dates";
import type { TaskRow } from "../schema";
import { rowMeta } from "./openView";

export type TaskRowViewProps = {
  row: TaskRow;
  today: Day;
  timeZone: string;
  onToggle: (row: TaskRow) => void;
  href: string;
};

/**
 * One task in a list: checkbox, title (struck through when done), when,
 * subtasks, parent and notes, and the High flag. `data-task-id` lets the
 * screen's keys find the row that has focus.
 */
export function TaskRowView({
  row,
  today,
  timeZone,
  onToggle,
  href,
}: TaskRowViewProps) {
  const done = row.completedAt !== null;
  const meta = rowMeta(row, today, timeZone);
  return (
    <div data-task-id={row.id}>
      <ItemRow
        leading={
          <Checkbox
            aria-label={`${done ? "Mark not done" : "Complete"}: ${row.title}`}
            isSelected={done}
            onChange={() => onToggle(row)}
          />
        }
        title={row.title}
        href={href}
        done={done}
        meta={
          meta.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {meta.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </span>
          ) : undefined
        }
        trailing={
          row.priority === "high" && !done ? <Flag>High</Flag> : undefined
        }
      />
    </div>
  );
}

import { useNavigate, useParams } from "@tanstack/react-router";
import { type ComponentType, useState } from "react";
import { DonePage } from "./DonePage";
import { lastList, type TaskListPath } from "./lastList";
import { OpenPage } from "./OpenPage";
import { TaskDetail } from "./TaskDetail";
import { UpcomingPage } from "./UpcomingPage";

const LISTS: Record<TaskListPath, ComponentType> = {
  "/tasks": OpenPage,
  "/tasks/upcoming": UpcomingPage,
  "/tasks/done": DonePage,
};

/**
 * `/tasks/$id`: the Detail panel over the list it was opened from (Open when
 * it came from elsewhere). Closing goes back to that list.
 */
export function DetailRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const [from] = useState(lastList);
  const List = LISTS[from];
  return (
    <>
      <List />
      <div className="fixed inset-y-0 right-0 z-30 flex p-4 pb-28">
        <TaskDetail
          key={id}
          id={id}
          onClose={() => void navigate({ to: from })}
        />
      </div>
    </>
  );
}

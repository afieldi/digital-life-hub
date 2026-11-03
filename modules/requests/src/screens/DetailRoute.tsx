import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { OpenPage } from "./OpenPage";
import { lastQueueList } from "./QueueHeader";
import { RequestDetail } from "./RequestDetail";
import { ResolvedPage } from "./ResolvedPage";

/**
 * `/queue/$id`: the Detail panel over the list it was opened from (Open when
 * it came from elsewhere). Closing goes back to that list and its filter.
 */
export function DetailRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const [from] = useState(lastQueueList);
  return (
    <>
      {from.path === "/queue/resolved" ? (
        <ResolvedPage search={from.search} />
      ) : (
        <OpenPage />
      )}
      <div className="fixed inset-y-0 right-0 z-30 flex p-4 pb-28">
        <RequestDetail
          key={id}
          id={id}
          onClose={() => void navigate({ to: from.path, search: from.search })}
        />
      </div>
    </>
  );
}

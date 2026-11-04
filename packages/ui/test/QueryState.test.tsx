import { fireEvent, render, screen } from "@testing-library/react";
import { QueryState } from "../src/patterns/QueryState";

const query = (
  over: Partial<{ isPending: boolean; isError: boolean }> = {},
) => ({
  isPending: false,
  isError: false,
  refetch: vi.fn(),
  ...over,
});

test("loading, error with Retry, empty, then the content", () => {
  const content = vi.fn(() => <p>rows</p>);
  const show = (q: ReturnType<typeof query>, isEmpty = false) =>
    render(
      <QueryState
        query={q}
        errorTitle="Couldn't load tasks"
        isEmpty={isEmpty}
        empty={<p>nothing</p>}
      >
        {content}
      </QueryState>,
    );

  show(query({ isPending: true })).unmount();
  expect(content).not.toHaveBeenCalled();

  const failed = query({ isError: true });
  const view = show(failed);
  expect(screen.getByText("Couldn't load tasks")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(failed.refetch).toHaveBeenCalledOnce();
  view.unmount();

  show(query(), true).unmount();
  expect(content).not.toHaveBeenCalled();

  show(query());
  expect(screen.getByText("rows")).toBeInTheDocument();
});

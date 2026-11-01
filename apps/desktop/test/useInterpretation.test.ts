import { applicableActions, coreAiActions } from "@dlh/core";
import { renderHook, waitFor } from "@testing-library/react";
import { useInterpretation } from "../src/ai/useInterpretation";

const actions = applicableActions(Object.values(coreAiActions), "test");

test("a guess for older text is kept on screen but not current", async () => {
  const { result, rerender } = renderHook(
    ({ text }) => useInterpretation(text, "test", actions),
    { initialProps: { text: "give this a better title" } },
  );
  await waitFor(() => expect(result.current.current).toBe(true));
  expect(result.current.interpretation?.actionId).toBe("retitle");

  rerender({ text: "delete this" });
  expect(result.current.current).toBe(false);
  expect(result.current.interpretation?.actionId).toBe("retitle");

  await waitFor(() => expect(result.current.current).toBe(true));
  expect(result.current.interpretation?.actionId).toBe("delete");
});

test("empty text has no interpretation", () => {
  const { result } = renderHook(() => useInterpretation("  ", "test", actions));
  expect(result.current).toEqual({ interpretation: null, current: true });
});

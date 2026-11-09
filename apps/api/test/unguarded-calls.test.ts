import { UNGUARDED_CALLS } from "@dlh/server";
import { expect, test } from "vitest";
import { serverModules } from "../src/modules.gen";

test("every call UNGUARDED_CALLS lists is made by an operation the app has", () => {
  const calls = new Set(
    serverModules.flatMap((m) =>
      Object.values(m.operations ?? {}).flatMap((op) =>
        (op.desc.calls ?? []).map(
          (c: { id: string }) => `${op.desc.id} -> ${c.id}`,
        ),
      ),
    ),
  );
  for (const pair of UNGUARDED_CALLS) expect(calls, pair).toContain(pair);
});

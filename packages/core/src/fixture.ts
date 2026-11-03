import { z } from "zod";
import { itemTitle } from "./items";
import { describeOperation } from "./operations/describe";

/**
 * A test-only module's operations, for tests of Core features that need some
 * item and some module: item type `fixture`. `@dlh/server/testing` implements
 * them; a test registers the module with `createTestApi({ modules })`.
 */
export const fixtureOps = {
  create: describeOperation({
    id: "fixture.create",
    kind: "mutation",
    label: "New fixture",
    description: "Creates a fixture item with the title given.",
    appliesTo: ["*", "none"],
    group: "create",
    input: z.object({ title: itemTitle }),
    subject: () => null,
    effects: ["createItems"],
    summary: (input) => `New fixture: ${input.title}`,
  }),
};

import { z } from "zod";

/**
 * One `/changes` event (an SSE `data:` line): the items written since the last
 * one, and their types, so a client can refresh only what shows them. `types`
 * may be missing (an older server, or a lookup that failed): refresh all.
 */
export const changeEvent = z.object({
  ids: z.array(z.string()),
  types: z.array(z.string()).optional(),
});
export type ChangeEvent = z.infer<typeof changeEvent>;

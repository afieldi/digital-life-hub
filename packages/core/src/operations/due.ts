import { z } from "zod";

/**
 * When a thing is due, in Google Calendar's shape: a whole day with no time
 * (floating, the same day in every zone), or a moment with the IANA zone it
 * was set in.
 */
export const dueValue = z.union([
  z.object({ date: z.iso.date() }).strict(),
  z
    .object({
      dateTime: z.iso.datetime({ offset: true }),
      timeZone: z.string().optional(),
    })
    .strict(),
]);
export type Due = z.infer<typeof dueValue>;

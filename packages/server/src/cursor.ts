import { TRPCError } from "@trpc/server";
import type { z } from "zod";

/**
 * A page cursor clients pass back untouched: `encode` packs where a page
 * ended (e.g. the last row's sort keys) into base64url JSON, and `decode`
 * checks it against `schema`, refusing anything else as BAD_REQUEST.
 */
export function opaqueCursor<S extends z.ZodType>(schema: S) {
  return {
    encode(value: z.input<S>): string {
      return Buffer.from(JSON.stringify(value)).toString("base64url");
    },
    decode(cursor: string): z.output<S> {
      try {
        return schema.parse(
          JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid cursor" });
      }
    },
  };
}

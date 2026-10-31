import type { ItemSummary } from "@dlh/core";
import type { Db } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { toSummary } from "./read";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 200;
/** Default 0.3 misses one-letter typos against longer titles ("plnning" vs "Quarterly planning" is 0.29). */
const SIMILARITY_THRESHOLD = 0.25;

/** Escapes `%`, `_` and `\` so the string matches literally inside `like ... escape '\'`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * Ranked search over live items: full-text (stemmed, title weighted over search_text),
 * trigram similarity on the title for typos, and a literal title prefix match.
 * Archived items score half.
 */
export async function searchItems(
  db: Db,
  opts: { query: string; types?: string[]; limit?: number },
): Promise<ItemSummary[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `limit must be 1 to ${MAX_LIMIT}`,
    });
  }
  // NUL bytes are not valid in Postgres text.
  const q = opts.query.replaceAll("\0", "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!q) return [];
  const prefix = `${escapeLike(q)}%`;
  const typeFilter = opts.types?.length
    ? sql`and type in (${sql.join(
        opts.types.map((t) => sql`${t}`),
        sql`, `,
      )})`
    : sql``;
  const rows = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('pg_trgm.similarity_threshold', ${String(SIMILARITY_THRESHOLD)}, true)`,
    );
    return tx.execute<{
      id: string;
      type: string;
      title: string;
      archived_at: Date | null;
    }>(sql`
    with q as (select websearch_to_tsquery('english', ${q}) as tsq)
    select id, type, title, archived_at,
      (ts_rank(search, q.tsq) + similarity(title, ${q})
        + case when title ilike ${prefix} escape '\\' then 0.5 else 0 end)
      * case when archived_at is null then 1 else 0.5 end as score
    from items, q
    where deleted_at is null ${typeFilter}
      and (search @@ q.tsq or title % ${q} or title ilike ${prefix} escape '\\')
    order by score desc, updated_at desc
    limit ${limit}`);
  });
  return rows.map((r) =>
    toSummary({
      id: r.id,
      type: r.type,
      title: r.title,
      archivedAt: r.archived_at ? new Date(r.archived_at) : null,
    }),
  );
}

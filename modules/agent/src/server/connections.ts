import { implementOperation } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { agentConnections } from "../db/schema";
import { agentOps } from "../operations";
import { connectionType } from "../schema";
import { notFound } from "./runs";
import { readSettings, writeSettings } from "./settings";

export const connectionsQuery = implementOperation(agentOps.connections, {
  async run(deps) {
    const rows = await deps.db
      .select()
      .from(agentConnections)
      // Live ones first, then disabled; by name within each.
      .orderBy(
        sql`${agentConnections.disabledAt} is not null`,
        asc(agentConnections.name),
      );
    const { defaultConnectionIds } = await readSettings(deps.db);
    return {
      connections: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: connectionType.parse(r.type),
        scopeSummary: r.scopeSummary,
        createdAt: r.createdAt.toISOString(),
        disabledAt: r.disabledAt?.toISOString() ?? null,
        isDefault: defaultConnectionIds.includes(r.id),
      })),
    };
  },
});

export const setDefaultConnections = implementOperation(
  agentOps.setDefaultConnections,
  {
    async run(w, input) {
      const ids = [...new Set(input.ids)];
      if (ids.length > 0) {
        const known = await w.tx
          .select({ id: agentConnections.id })
          .from(agentConnections)
          .where(
            and(
              inArray(agentConnections.id, ids),
              isNull(agentConnections.disabledAt),
            ),
          );
        if (known.length !== ids.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Unknown or disabled connection",
          });
        }
      }
      const before = await readSettings(w.tx, { lock: true });
      const result = await writeSettings(w.tx, { defaultConnectionIds: ids });
      return {
        result,
        undo: { ids: before.defaultConnectionIds },
      };
    },
    async undo(w, record) {
      await writeSettings(w.tx, { defaultConnectionIds: record.ids });
    },
    undoRecord: z.object({ ids: z.array(z.uuid()) }),
  },
);

export const disableConnection = implementOperation(
  agentOps.disableConnection,
  {
    async run(w, input, deps) {
      const [row] = await w.tx
        .select()
        .from(agentConnections)
        .where(eq(agentConnections.id, input.id))
        .for("update");
      if (!row) notFound("Connection not found");
      if (row.disabledAt !== null) {
        return { result: { id: row.id }, undo: null };
      }
      await w.tx
        .update(agentConnections)
        .set({ disabledAt: deps.now() })
        .where(eq(agentConnections.id, input.id));
      return { result: { id: row.id }, undo: { id: row.id } };
    },
    async undo(w, record) {
      if (!record) return;
      await w.tx
        .update(agentConnections)
        .set({ disabledAt: null })
        .where(eq(agentConnections.id, record.id));
    },
    undoRecord: z.object({ id: z.uuid() }).nullable(),
  },
);

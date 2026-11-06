import { implementOperation } from "@dlh/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { slackPeople } from "../db/schema";
import { slackOps } from "../operations";
import { type SlackPerson, slackPerson } from "../schema";

export const people = implementOperation(slackOps.people, {
  async run(deps): Promise<SlackPerson[]> {
    const rows = await deps.db
      .select()
      .from(slackPeople)
      .orderBy(asc(slackPeople.name), asc(slackPeople.slackUserId));
    return rows.map((r) => slackPerson.parse(r));
  },
});

/** What undo restores: the person as they were, or null when the call added them. */
const before = slackPerson.nullable();

export const setGithubLogin = implementOperation(slackOps.setGithubLogin, {
  async run(w, input) {
    const [prior] = await w.tx
      .select()
      .from(slackPeople)
      .where(eq(slackPeople.slackUserId, input.slackUserId))
      .for("update");
    // Clearing the login also hands it back to the profile, which may fill it again.
    const set = {
      githubLogin: input.githubLogin,
      githubFrom: input.githubLogin === null ? "profile" : "manual",
      updatedAt: sql`now()`,
    };
    const [row] = await w.tx
      .insert(slackPeople)
      .values({ slackUserId: input.slackUserId, name: "", ...set })
      .onConflictDoUpdate({ target: slackPeople.slackUserId, set })
      .returning();
    return {
      result: slackPerson.parse(row),
      undo: prior ? slackPerson.parse(prior) : null,
    };
  },
  async undo(w, record) {
    if (record === null) return;
    await w.tx
      .update(slackPeople)
      .set(record)
      .where(eq(slackPeople.slackUserId, record.slackUserId));
  },
  undoRecord: before,
});

export const upsertPerson = implementOperation(slackOps.upsertPerson, {
  async run(w, input) {
    const [row] = await w.tx
      .insert(slackPeople)
      .values({
        slackUserId: input.slackUserId,
        name: input.name,
        githubLogin: input.githubLogin,
        githubFrom: "profile",
      })
      .onConflictDoUpdate({
        target: slackPeople.slackUserId,
        set: {
          name: input.name,
          // A login you set is never overwritten by the profile.
          githubLogin: sql`case when ${slackPeople.githubFrom} = 'manual' then ${slackPeople.githubLogin} else excluded.github_login end`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return { result: slackPerson.parse(row), undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

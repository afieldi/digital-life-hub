import { spawnSync } from "node:child_process";
import { findServiceToken } from "@dlh/server";
import { freshModuleDb, serverModules } from "../src/testing";

/** Runs `tokens <args>` against the database at `url`. */
function tokens(url: string, ...args: string[]) {
  const res = spawnSync(
    "pnpm",
    ["exec", "tsx", "src/cli/serviceTokens.ts", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: url },
    },
  );
  expect(res.error).toBeUndefined();
  return res;
}

test("tokens slack create prints an id and a token once; revoke revokes it", async () => {
  const t = await freshModuleDb(serverModules);
  const created = tokens(t.url, "slack", "create");
  expect(created.status, created.stderr).toBe(0);
  const id = /^id\s+(\S+)$/m.exec(created.stdout)?.[1];
  const token = /^token\s+(\S+)$/m.exec(created.stdout)?.[1];
  expect(id).toBeTruthy();
  expect(token).toBeTruthy();
  expect(await findServiceToken(t.db, token as string)).toEqual({
    kind: "slack",
    tokenId: id,
  });

  const revoked = tokens(t.url, "slack", "revoke", id as string);
  expect(revoked.status, revoked.stderr).toBe(0);
  expect(revoked.stdout).toContain("Revoked 1 slack token(s).");
  expect(await findServiceToken(t.db, token as string)).toBeNull();

  const again = tokens(t.url, "slack", "revoke", id as string);
  expect(again.status).toBe(1);
  await t.close();
}, 60_000);

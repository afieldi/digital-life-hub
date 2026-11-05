import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/api";
import type { Config } from "../src/config";

type Seen = { method?: string; url?: string; auth?: string; body: string };

let server: Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
});

async function start(
  handle: (
    req: IncomingMessage,
    seen: Seen,
    res: import("node:http").ServerResponse,
  ) => void,
) {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const s = {
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body,
      };
      seen.push(s);
      handle(req, s, res);
    });
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen };
}

const config = (apiUrl: string): Config => ({
  apiUrl,
  workerToken: "worker-secret",
  gatewayKey: "gw",
  gatewayUrl: "https://example.test",
  secretsKey: Buffer.alloc(32),
  dataDir: "/tmp/x",
});

const json = (
  res: import("node:http").ServerResponse,
  body: unknown,
  status = 200,
) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

describe("createApi", () => {
  it("the worker client sends the worker token", async () => {
    const { url, seen } = await start((_r, _s, res) =>
      json(res, { result: { data: { run: null } } }),
    );
    const api = createApi(config(url));
    const out = await api.worker.agent.claim.mutate({});
    expect(out).toEqual({ run: null });
    expect(seen[0].url).toContain("/trpc/agent.claim");
    expect(seen[0].auth).toBe("Bearer worker-secret");
  });

  it("asRun posts a mutation to /trpc/<id> with the run token", async () => {
    const { url, seen } = await start((_r, _s, res) =>
      json(res, { result: { data: { ok: 1 } } }),
    );
    const out = await createApi(config(url))
      .asRun("run-tok")
      .call("tasks.create", { title: "x" }, "mutation");
    expect(out).toEqual({ ok: 1 });
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe("/trpc/tasks.create");
    expect(seen[0].auth).toBe("Bearer run-tok");
    expect(JSON.parse(seen[0].body)).toEqual({ title: "x" });
  });

  it("asRun gets a query", async () => {
    const { url, seen } = await start((_r, _s, res) =>
      json(res, { result: { data: [1, 2] } }),
    );
    const out = await createApi(config(url))
      .asRun("run-tok")
      .call("tasks.list", { a: "b c" }, "query");
    expect(out).toEqual([1, 2]);
    expect(seen[0].method).toBe("GET");
    const u = new URL(seen[0].url ?? "", "http://x");
    expect(u.pathname).toBe("/trpc/tasks.list");
    expect(JSON.parse(u.searchParams.get("input") ?? "")).toEqual({ a: "b c" });
    expect(seen[0].auth).toBe("Bearer run-tok");
  });

  it("asRun throws the hub's error code and message", async () => {
    const { url } = await start((_r, _s, res) =>
      json(
        res,
        { error: { message: "nope", data: { code: "FORBIDDEN" } } },
        403,
      ),
    );
    await expect(
      createApi(config(url)).asRun("t").call("x.y", {}, "mutation"),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "nope" });
  });

  it("onChanges reconnects after the stream drops", async () => {
    let connections = 0;
    const { url, seen } = await start((_r, _s, res) => {
      connections++;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": ping\n\n");
      res.write(
        `data: ${JSON.stringify({ ids: [`i${connections}`], types: ["task"] })}\n\n`,
      );
      if (connections === 1) res.end(); // drop the first stream
    });
    const got: string[][] = [];
    const stop = createApi(config(url), { backoffMs: () => 5 }).onChanges(
      (ids) => got.push(ids),
    );
    await expect
      .poll(() => got.length, { timeout: 3000 })
      .toBeGreaterThanOrEqual(2);
    stop();
    expect(got.slice(0, 2)).toEqual([["i1"], ["i2"]]);
    expect(seen[0].auth).toBe("Bearer worker-secret");
    expect(seen[0].url).toBe("/changes");
  });
});

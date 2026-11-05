import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  type EventsRequest,
  eventsRequest,
  type FailRequest,
  type FinishRequest,
  failRequest,
  finishRequest,
  type HubRequest,
  hubRequest,
  type SessionRequest,
  type SuspendRequest,
  sessionRequest,
  suspendRequest,
} from "@dlh/agent-protocol";
import type { z } from "zod";

/** A route's answer; `after` runs once the answer is out or the runner has gone. */
export type Reply = { status: number; body: unknown; after?: () => void };

/** What one run's socket serves. Each JSON route gets its body already checked. */
export type RunRoutes = {
  run(): Reply;
  events(body: EventsRequest): Reply;
  /** Long-polls up to `waitSeconds`; `gone` aborts when the runner hangs up. */
  messages(waitSeconds: number, gone: AbortSignal): Promise<Reply>;
  hub(body: HubRequest): Promise<Reply>;
  credentials(type: string, name: string): Reply | Promise<Reply>;
  suspend(body: SuspendRequest): Promise<Reply>;
  finish(body: FinishRequest): Promise<Reply>;
  fail(body: FailRequest): Promise<Reply>;
  session(body: SessionRequest): Reply;
  /** `/model/*`, passed through untouched; it answers on its own. */
  model(req: IncomingMessage, res: ServerResponse): void;
};

/** Bodies above this are refused; events carry tool output, so it's generous. */
const MAX_BODY = 16 * 1024 * 1024;
/** The runner asks for 25 s; more is capped so a poll can't hang forever. */
const MAX_WAIT_SECONDS = 60;

class BadRequest extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<S extends z.ZodType>(
  req: IncomingMessage,
  schema: S,
): Promise<z.output<S>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new BadRequest(413, "Body too large");
    chunks.push(c as Buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest(400, "Body is not JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequest(400, "Body doesn't match");
  return parsed.data;
}

function send(res: ServerResponse, reply: Reply) {
  // `close` also fires when the runner hangs up before the answer is out.
  if (reply.after) res.once("close", reply.after);
  res.writeHead(reply.status, { "content-type": "application/json" });
  res.end(JSON.stringify(reply.body));
}

const error = (status: number, message: string): Reply => ({
  status,
  body: { error: message },
});

async function route(
  routes: RunRoutes,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Reply | undefined> {
  const url = new URL(req.url ?? "/", "http://run");
  const path = url.pathname;
  const get = req.method === "GET";
  const post = req.method === "POST";

  if ((req.url ?? "").startsWith("/model/")) {
    routes.model(req, res);
    return undefined;
  }
  if (get && path === "/run") return routes.run();
  if (get && path === "/messages") {
    const wait = Number(url.searchParams.get("wait") ?? 0);
    const seconds = Number.isFinite(wait)
      ? Math.min(Math.max(wait, 0), MAX_WAIT_SECONDS)
      : 0;
    const gone = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) gone.abort();
    });
    return routes.messages(seconds, gone.signal);
  }
  const credentials = get && /^\/credentials\/([^/]+)\/([^/]+)$/.exec(path);
  if (credentials) {
    return routes.credentials(
      decodeURIComponent(credentials[1] ?? ""),
      decodeURIComponent(credentials[2] ?? ""),
    );
  }
  if (post && path === "/events")
    return routes.events(await readJson(req, eventsRequest));
  if (post && path === "/hub")
    return routes.hub(await readJson(req, hubRequest));
  if (post && path === "/suspend")
    return routes.suspend(await readJson(req, suspendRequest));
  if (post && path === "/finish")
    return routes.finish(await readJson(req, finishRequest));
  if (post && path === "/fail")
    return routes.fail(await readJson(req, failRequest));
  if (post && path === "/session")
    return routes.session(await readJson(req, sessionRequest));
  return error(404, "No such route");
}

/**
 * The HTTP server behind one run's Unix socket. A route that throws answers
 * 500 with no detail, so nothing from a secret or a body reaches the runner
 * or the log through it.
 */
export function createRunServer(
  routes: RunRoutes,
  log: (line: string) => void,
): Server {
  return createServer((req, res) => {
    route(routes, req, res).then(
      (reply) => {
        if (reply) send(res, reply);
      },
      (e: unknown) => {
        if (e instanceof BadRequest) {
          send(res, error(e.status, e.message));
          return;
        }
        log(`socket route ${req.method} ${req.url?.split("?")[0]} failed`);
        if (!res.headersSent) send(res, error(500, "Worker error"));
        else res.end();
      },
    );
  });
}

import { request } from "node:http";
import {
  credentialsResponse,
  type EventsRequest,
  type FailRequest,
  type FinishRequest,
  type HubRequest,
  type HubResponse,
  hubResponse,
  type MessagesResponse,
  messagesResponse,
  type RunStart,
  runStart,
  type SuspendRequest,
  type SuspendResponse,
  suspendResponse,
} from "@dlh/agent-protocol";
import type { z } from "zod";

/** The run's socket inside the container. */
export const SOCKET_PATH = "/run/dlh/dlh.sock";

export type EventBatch = EventsRequest["events"];
type Message = MessagesResponse["messages"][number];

/** The worker, as the runner reaches it over the run's socket. */
export interface Host {
  run(): Promise<RunStart>;
  events(events: EventBatch): Promise<void>;
  /** Long-polls up to `waitSeconds`; 0 answers at once. */
  messages(waitSeconds: number, signal?: AbortSignal): Promise<Message[]>;
  hub(req: HubRequest): Promise<HubResponse>;
  /** Ends the run on the worker's side: the container is stopped after it. */
  suspend(req: SuspendRequest): Promise<SuspendResponse>;
  finish(req: FinishRequest): Promise<void>;
  fail(req: FailRequest): Promise<void>;
  session(sessionId: string): Promise<void>;
  /** A granted connection's secret; refused (403) for one not granted. */
  credentials(type: string, name: string): Promise<Record<string, string>>;
}

/** A route that didn't answer 2xx. The body's `error` is the worker's own text. */
export class HostError extends Error {
  override name = "HostError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function call(
  socketPath: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath,
        method,
        path,
        signal,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let value: unknown;
          try {
            value = text ? JSON.parse(text) : {};
          } catch {
            value = {};
          }
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const error =
              typeof value === "object" && value && "error" in value
                ? String(value.error)
                : `HTTP ${status}`;
            reject(new HostError(status, `${method} ${path}: ${error}`));
            return;
          }
          resolve(value);
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** The real host: JSON over HTTP on the run's Unix socket. */
export function createHost(socketPath = SOCKET_PATH): Host {
  const get = async <S extends z.ZodType>(
    path: string,
    schema: S,
    signal?: AbortSignal,
  ) => schema.parse(await call(socketPath, "GET", path, undefined, signal));
  const post = (path: string, body: unknown) =>
    call(socketPath, "POST", path, body);

  return {
    run: () => get("/run", runStart),
    async events(events) {
      await post("/events", { events });
    },
    async messages(waitSeconds, signal) {
      const r = await get(
        `/messages?wait=${waitSeconds}`,
        messagesResponse,
        signal,
      );
      return r.messages;
    },
    async hub(req) {
      return hubResponse.parse(await post("/hub", req));
    },
    async suspend(req) {
      return suspendResponse.parse(await post("/suspend", req));
    },
    async finish(req) {
      await post("/finish", req);
    },
    async fail(req) {
      await post("/fail", req);
    },
    async session(sessionId) {
      await post("/session", { sessionId });
    },
    async credentials(type, name) {
      const path = `/credentials/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;
      return (await get(path, credentialsResponse)).secret;
    },
  };
}

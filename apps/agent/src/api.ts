import type { ChangeEvent } from "@dlh/api-contract";
import type { AgentRouter } from "@dlh/module-agent/server";
import type { router } from "@dlh/server";
import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
import type { Config } from "./config";

/** The API's router as far as the worker goes: the agent module's operations. */
type WorkerRouter = ReturnType<typeof router<{ agent: AgentRouter }>>;

/** A hub call that came back as an error: tRPC's `code` and the message. */
export class HubError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HubError";
  }
}

export type WorkerApi = {
  /** Typed client for the worker-only operations, signed in as the worker. */
  worker: TRPCClient<WorkerRouter>;
  /** Calls any hub operation by id, signed in as the run with `token`. */
  asRun(token: string): {
    call(
      id: string,
      input: unknown,
      kind: "query" | "mutation",
    ): Promise<unknown>;
  };
  /** Listens to `/changes` as the worker, reconnecting with backoff; returns stop. */
  onChanges(cb: (ids: string[], types?: string[]) => void): () => void;
};

export type ApiOptions = {
  fetch?: typeof fetch;
  backoffMs?: (attempt: number) => number;
};

const MAX_BACKOFF_MS = 30_000;
const defaultBackoff = (attempt: number) =>
  Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);

export function createApi(config: Config, opts: ApiOptions = {}): WorkerApi {
  const doFetch = opts.fetch ?? fetch;
  const backoffMs = opts.backoffMs ?? defaultBackoff;
  const base = config.apiUrl.replace(/\/$/, "");

  const worker = createTRPCClient<WorkerRouter>({
    links: [
      httpLink({
        url: `${base}/trpc`,
        fetch: doFetch,
        headers: () => ({ Authorization: `Bearer ${config.workerToken}` }),
      }),
    ],
  });

  const asRun: WorkerApi["asRun"] = (token) => ({
    async call(id, input, kind) {
      const headers = { Authorization: `Bearer ${token}` };
      const res =
        kind === "mutation"
          ? await doFetch(`${base}/trpc/${id}`, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(input ?? {}),
            })
          : await doFetch(
              `${base}/trpc/${id}?input=${encodeURIComponent(JSON.stringify(input ?? {}))}`,
              { headers },
            );
      const body = (await res.json().catch(() => null)) as {
        result?: { data?: unknown };
        error?: { message?: string; data?: { code?: string } };
      } | null;
      if (body?.error || !res.ok || !body?.result) {
        throw new HubError(
          body?.error?.data?.code ?? `HTTP_${res.status}`,
          body?.error?.message ?? `Hub call ${id} failed (${res.status})`,
        );
      }
      return body.result.data;
    },
  });

  const onChanges: WorkerApi["onChanges"] = (cb) => {
    const controller = new AbortController();
    let wake: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, ms);
      });

    const deliver = (data: string) => {
      try {
        const event = JSON.parse(data) as ChangeEvent;
        if (Array.isArray(event.ids)) cb(event.ids, event.types);
      } catch {
        // A malformed event is skipped; the stream stays up.
      }
    };

    const loop = async () => {
      let attempt = 0;
      while (!controller.signal.aborted) {
        try {
          const res = await doFetch(`${base}/changes`, {
            headers: { Authorization: `Bearer ${config.workerToken}` },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`changes: ${res.status}`);
          const reader = res.body
            .pipeThrough(new TextDecoderStream())
            .getReader();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            attempt = 0;
            buffer += value.replace(/\r\n?/g, "\n");
            for (
              let end = buffer.indexOf("\n\n");
              end !== -1;
              end = buffer.indexOf("\n\n")
            ) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const data = block
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).replace(/^ /, ""))
                .join("\n");
              if (data) deliver(data);
            }
          }
        } catch {
          // Fall through to the backoff (an abort ends the loop).
        }
        if (controller.signal.aborted) return;
        await sleep(backoffMs(attempt++));
      }
    };
    void loop();

    return () => {
      controller.abort();
      clearTimeout(timer);
      wake?.();
    };
  };

  return { worker, asRun, onChanges };
}

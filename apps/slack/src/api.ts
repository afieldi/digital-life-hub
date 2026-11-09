import type { ChangeEvent } from "@dlh/api-contract";
import type { SlackRouter } from "@dlh/module-slack/server";
import type { router } from "@dlh/server";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { Config } from "./config";

/** The API's router as far as this service goes: the slack module's operations. */
type SlackServiceRouter = ReturnType<typeof router<{ slack: SlackRouter }>>;
type Client = ReturnType<typeof createTRPCClient<SlackServiceRouter>>["slack"];

export type BotSettings = Awaited<ReturnType<Client["botSettings"]["query"]>>;
export type HandleMessageInput = Parameters<
  Client["handleMessage"]["mutate"]
>[0];
/** What a mutation answers is `{ result, undo }`; this service wants the result. */
export type HandleMessageResult = Awaited<
  ReturnType<Client["handleMessage"]["mutate"]>
>["result"];
export type HandleActionInput = Parameters<Client["handleAction"]["mutate"]>[0];
export type HandleActionResult = Awaited<
  ReturnType<Client["handleAction"]["mutate"]>
>["result"];
export type PendingSend = Awaited<
  ReturnType<Client["pendingSends"]["mutate"]>
>["result"][number];
export type Turn = HandleMessageInput["context"][number];

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

/** The operations this service calls, signed in with its slack token. */
export type HubApi = {
  botSettings(): Promise<BotSettings>;
  upsertPerson(input: {
    slackUserId: string;
    name: string;
    githubLogin: string | null;
  }): Promise<unknown>;
  handleMessage(input: HandleMessageInput): Promise<HandleMessageResult>;
  handleAction(input: HandleActionInput): Promise<HandleActionResult>;
  /** Queues the reports of agent runs that ended. */
  syncRuns(): Promise<unknown>;
  /** Notes the bot is alive; the approved messages to post, oldest first. */
  pendingSends(): Promise<PendingSend[]>;
  markSent(input: { id: string; ts: string }): Promise<unknown>;
  markFailed(input: { id: string; error: string }): Promise<unknown>;
  /** Listens to `/changes`, reconnecting with backoff; returns stop. */
  onChanges(cb: (ids: string[], types?: string[]) => void): () => void;
};

export type ApiOptions = {
  fetch?: typeof fetch;
  /** How long a call may take, answer read in full; 30 s by default. */
  timeoutMs?: number;
  backoffMs?: (attempt: number) => number;
};

const MAX_BACKOFF_MS = 30_000;
const defaultBackoff = (attempt: number) =>
  Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);

/** A call the API doesn't answer in time fails like a network error. */
const CALL_TIMEOUT_MS = 30_000;

/** A hub answer with an error code becomes a `HubError`; anything else (the network, a timeout) passes through. */
async function asHubError<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    const code =
      e instanceof TRPCClientError
        ? (e.data as { code?: string } | undefined)?.code
        : undefined;
    throw code ? new HubError(code, (e as Error).message) : e;
  }
}

/** Whether a failed hub call is worth repeating: the hub down or failing, not one that refused the call. */
export function isRetryable(e: unknown): boolean {
  return e instanceof HubError ? e.code === "INTERNAL_SERVER_ERROR" : true;
}

export function createApi(
  config: Pick<Config, "apiUrl" | "hubToken">,
  opts: ApiOptions = {},
): HubApi {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? CALL_TIMEOUT_MS;
  const backoffMs = opts.backoffMs ?? defaultBackoff;
  const base = config.apiUrl.replace(/\/$/, "");
  const timedFetch: typeof fetch = (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return doFetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  };
  const { slack } = createTRPCClient<SlackServiceRouter>({
    links: [
      httpLink({
        url: `${base}/trpc`,
        fetch: timedFetch,
        headers: () => ({ Authorization: `Bearer ${config.hubToken}` }),
      }),
    ],
  });
  /** Listens to `/changes` as the slack service, reconnecting with backoff; returns stop. */
  const onChanges: HubApi["onChanges"] = (cb) => {
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
            headers: { Authorization: `Bearer ${config.hubToken}` },
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

  return {
    botSettings: () => asHubError(slack.botSettings.query({})),
    upsertPerson: (input) => asHubError(slack.upsertPerson.mutate(input)),
    handleMessage: async (input) =>
      (await asHubError(slack.handleMessage.mutate(input))).result,
    handleAction: async (input) =>
      (await asHubError(slack.handleAction.mutate(input))).result,
    syncRuns: () => asHubError(slack.syncRuns.mutate({})),
    pendingSends: async () =>
      (await asHubError(slack.pendingSends.mutate({}))).result,
    markSent: (input) => asHubError(slack.markSent.mutate(input)),
    markFailed: (input) => asHubError(slack.markFailed.mutate(input)),
    onChanges,
  };
}

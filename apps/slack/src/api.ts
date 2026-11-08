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
};

export type ApiOptions = {
  fetch?: typeof fetch;
  /** How long a call may take, answer read in full; 30 s by default. */
  timeoutMs?: number;
};

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
        url: `${config.apiUrl.replace(/\/$/, "")}/trpc`,
        fetch: timedFetch,
        headers: () => ({ Authorization: `Bearer ${config.hubToken}` }),
      }),
    ],
  });
  return {
    botSettings: () => asHubError(slack.botSettings.query({})),
    upsertPerson: (input) => asHubError(slack.upsertPerson.mutate(input)),
    handleMessage: async (input) =>
      (await asHubError(slack.handleMessage.mutate(input))).result,
    handleAction: async (input) =>
      (await asHubError(slack.handleAction.mutate(input))).result,
  };
}

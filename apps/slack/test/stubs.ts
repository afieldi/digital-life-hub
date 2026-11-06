import type {
  HandleMessageInput,
  HandleMessageResult,
  HubApi,
} from "../src/api";
import type { SlackWeb } from "../src/context";

export const settings = {
  ownerSlackId: "UOWNER",
  teamId: "T1",
  botUserId: "UBOT",
};

type Msg = { ts: string; user?: string; bot_id?: string; text: string };

/** A Web API that records its calls and answers from `data`. */
export function stubWeb(
  data: {
    history?: Msg[];
    replies?: Msg[];
    fields?: Record<string, { value?: string; label?: string }>;
    realName?: string;
  } = {},
) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const rec = <T>(method: string, args: object, out: T): Promise<T> => {
    calls.push({ method, args: args as Record<string, unknown> });
    return Promise.resolve(out);
  };
  const web: SlackWeb = {
    chat: {
      postMessage: (a) => rec("chat.postMessage", a, {}),
      getPermalink: (a) =>
        rec("chat.getPermalink", a, {
          permalink: `https://x.slack.com/archives/${a.channel}/p${a.message_ts}`,
        }),
    },
    conversations: {
      history: (a) => rec("history", a, { messages: data.history ?? [] }),
      replies: (a) => rec("replies", a, { messages: data.replies ?? [] }),
    },
    reactions: { add: (a) => rec("reactions.add", a, {}) },
    users: {
      profile: {
        get: (a) =>
          rec("users.profile.get", a, {
            profile: {
              real_name: data.realName ?? "Dana Coworker",
              fields: data.fields ?? {
                X1: { label: "GitHub", value: "https://github.com/dana" },
              },
            },
          }),
      },
    },
  };
  return { web, calls, of: (m: string) => calls.filter((c) => c.method === m) };
}

/** A hub client that records calls; `handleMessage` answers from `answers`, or throws what it is given. */
export function stubApi(
  answers: Array<HandleMessageResult | Error> = [{ reply: "ok" }],
) {
  const calls: { method: string; at: number; input: unknown }[] = [];
  let n = 0;
  const api: HubApi = {
    botSettings: async () => settings,
    upsertPerson: async (input) => {
      calls.push({ method: "upsertPerson", at: Date.now(), input });
    },
    handleMessage: async (input) => {
      calls.push({ method: "handleMessage", at: Date.now(), input });
      const a = answers[Math.min(n++, answers.length - 1)] as
        | HandleMessageResult
        | Error;
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { api, calls, of: (m: string) => calls.filter((c) => c.method === m) };
}

/** The input of the first `handleMessage` call, as the hub would see it. */
export function firstSent(api: ReturnType<typeof stubApi>): HandleMessageInput {
  return api.of("handleMessage")[0]?.input as HandleMessageInput;
}

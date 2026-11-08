import type {
  HandleActionResult,
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
    /** `conversations.history` and `replies` fail, as when the bot isn't in the channel. */
    contextFails?: boolean;
    /** What `auth.test` answers, or an error; none by default (as an old Slack). */
    auth?: { team_id?: string; user_id?: string } | Error;
  } = {},
) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const rec = <T>(method: string, args: object, out: T): Promise<T> => {
    calls.push({ method, args: args as Record<string, unknown> });
    return Promise.resolve(out);
  };
  const web: SlackWeb = {
    auth: {
      test: () => {
        calls.push({ method: "auth.test", args: {} });
        return data.auth instanceof Error
          ? Promise.reject(data.auth)
          : Promise.resolve(data.auth ?? {});
      },
    },
    chat: {
      postMessage: (a) => rec("chat.postMessage", a, {}),
      getPermalink: (a) =>
        rec("chat.getPermalink", a, {
          permalink: `https://x.slack.com/archives/${a.channel}/p${a.message_ts}`,
        }),
    },
    conversations: {
      history: (a) =>
        data.contextFails
          ? Promise.reject(new Error("channel_not_found"))
          : rec("history", a, { messages: data.history ?? [] }),
      replies: (a) =>
        data.contextFails
          ? Promise.reject(new Error("channel_not_found"))
          : rec("replies", a, { messages: data.replies ?? [] }),
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
  actionAnswers: Array<HandleActionResult | Error> = [{ reply: "Done." }],
) {
  const calls: { method: string; at: number; input: unknown }[] = [];
  let n = 0;
  let m = 0;
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
    handleAction: async (input) => {
      calls.push({ method: "handleAction", at: Date.now(), input });
      const a = actionAnswers[Math.min(m++, actionAnswers.length - 1)] as
        | HandleActionResult
        | Error;
      if (a instanceof Error) throw a;
      return a;
    },
    syncRuns: async () => {},
    pendingSends: async () => [],
    markSent: async () => {},
    markFailed: async () => {},
    onChanges: () => () => {},
  };
  return { api, calls, of: (m: string) => calls.filter((c) => c.method === m) };
}

/** The input of the first `handleMessage` call, as the hub would see it. */
export function firstSent(api: ReturnType<typeof stubApi>): HandleMessageInput {
  return api.of("handleMessage")[0]?.input as HandleMessageInput;
}

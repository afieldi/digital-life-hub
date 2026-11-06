import { z } from "zod";

/**
 * The routes the host worker serves on each run's Unix socket, for the runner
 * inside the container. Every route is JSON over HTTP except `/model/*`, which
 * passes through to the model gateway. The shapes are defined here, not
 * imported from the agent module, so the runner can import this package
 * without pulling in server code. Every object refuses extra fields.
 */

const obj = z.strictObject;

/** Same values as the agent module's `eventKind`. */
export const eventKind = z.enum([
  "text",
  "tool",
  "tool_result",
  "file",
  "permission",
  "status",
]);

/**
 * The agent module's `decision`: the person's answer to a suspended run, with
 * what was asked as the API kept it. An approval allows only this tool and
 * input hash, never what the run's volume says was asked.
 */
export const decision = obj({
  seq: z.number().int(),
  approve: z.boolean(),
  delivered: z.boolean(),
  connectionId: z.string().optional(),
  tool: z.string().optional(),
  inputHash: z.string().optional(),
});
export type Decision = z.infer<typeof decision>;

/** `POST /events`: the runner sends events unnumbered; the worker numbers them. */
export const eventsRequest = obj({
  events: z.array(
    obj({
      at: z.iso.datetime(),
      kind: eventKind,
      data: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type EventsRequest = z.infer<typeof eventsRequest>;

/** `GET /messages?wait=25`: messages the person sent since the last call. */
export const messagesResponse = obj({
  messages: z.array(obj({ id: z.string(), body: z.string() })),
});
export type MessagesResponse = z.infer<typeof messagesResponse>;

/** `GET /run`: what the runner needs to start or resume. */
export const runStart = obj({
  runId: z.string(),
  task: obj({
    id: z.string(),
    title: z.string(),
    notes: z.string().nullable(),
  }),
  request: obj({
    sender: z.string().nullable(),
    body: z.string().nullable(),
    source: z.string(),
    sourceUrl: z.string().nullable(),
  }).nullable(),
  instructions: z.string(),
  /** Every live connection, granted or not. */
  connections: z.array(
    obj({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      scopeSummary: z.string(),
    }),
  ),
  /** The ids among `connections` this run may fetch credentials for. */
  grantedIds: z.array(z.string()),
  sessionId: z.string().nullable(),
  decision: decision.nullable(),
  lastSeq: z.number().int(),
});
export type RunStart = z.infer<typeof runStart>;

/** `POST /hub`: a call to a hub operation as the run. */
export const hubRequest = obj({
  operation: z.string().min(1),
  input: z.unknown(),
});
export type HubRequest = z.infer<typeof hubRequest>;

export const hubResponse = z.discriminatedUnion("ok", [
  obj({ ok: z.literal(true), result: z.unknown() }),
  obj({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
export type HubResponse = z.infer<typeof hubResponse>;

/** `GET /credentials/:type/:name`: refused unless the connection is in the run's granted set. */
export const credentialsResponse = obj({
  secret: z.record(z.string(), z.string()),
});
export type CredentialsResponse = z.infer<typeof credentialsResponse>;

/** `POST /suspend`: park the run until the person answers. */
export const suspendRequest = obj({
  sessionId: z.string().min(1),
  kind: z.enum(["approval", "grant"]),
  title: z.string().min(1),
  body: z.string(),
  tool: z.string().optional(),
  inputHash: z.string().optional(),
  connectionId: z.string().optional(),
});
export type SuspendRequest = z.infer<typeof suspendRequest>;

export const suspendResponse = obj({ seq: z.number().int() });
export type SuspendResponse = z.infer<typeof suspendResponse>;

/** Same shape as the agent module's `report`. */
export const report = obj({
  summary: z.string(),
  links: z.array(obj({ label: z.string(), url: z.string() })),
  filesChanged: z.array(z.string()),
});
export type Report = z.infer<typeof report>;

/** `POST /finish` */
export const finishRequest = obj({ report });
export type FinishRequest = z.infer<typeof finishRequest>;

/** `POST /fail` */
export const failRequest = obj({
  code: z.string().min(1),
  message: z.string(),
});
export type FailRequest = z.infer<typeof failRequest>;

/** `POST /session`: the first time the agent session's id is known. */
export const sessionRequest = obj({ sessionId: z.string().min(1) });
export type SessionRequest = z.infer<typeof sessionRequest>;

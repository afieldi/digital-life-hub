import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type ScriptedTurn = {
  text?: string;
  toolUse?: { name: string; input: unknown };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** Answer with this status and an error body instead of a stream. */
  status?: number;
  /** Send the real API's null input and cache fields in `message_delta`. */
  nullDelta?: boolean;
  /** Answer only once this settles, e.g. to stop a worker mid-turn. */
  hold?: Promise<unknown>;
};

export type SeenRequest = {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

const ASIDE: ScriptedTurn = {
  text: "ok",
  usage: { input_tokens: 1, output_tokens: 1 },
};

const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export type FakeOptions = {
  /**
   * Which requests play the script. The others (a CLI's side calls, such as
   * a title or a quota check) get `aside`. Default: every request.
   */
  isTurn?: (req: SeenRequest) => boolean;
  aside?: ScriptedTurn;
};

/**
 * A stand-in for the Messages API: each `/v1/messages` call plays the next
 * scripted turn (the last one again once the script runs out).
 */
export async function fakeAnthropic(
  script: ScriptedTurn[],
  opts: FakeOptions = {},
) {
  const requests: SeenRequest[] = [];
  /** The requests that played a scripted turn, in order. */
  const turns: SeenRequest[] = [];
  let next = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const seen: SeenRequest = {
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(seen);
      if (seen.url.includes("/count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      const playing = opts.isTurn?.(seen) ?? true;
      if (playing) turns.push(seen);
      // Ids by script position: unique per turn, the same for a replay.
      const at = playing ? Math.min(next++, script.length - 1) : -1;
      const turn: ScriptedTurn | undefined = playing
        ? script[at]
        : (opts.aside ?? ASIDE);
      if (turn?.hold) await turn.hold;
      if (!turn) {
        res.writeHead(500).end();
        return;
      }
      if (turn.status) {
        res.writeHead(turn.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "scripted" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const { usage } = turn;
      res.write(
        sse("message_start", {
          type: "message_start",
          message: {
            id: `msg_${at + 1}`,
            type: "message",
            role: "assistant",
            model: "claude-opus-5-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { ...usage, output_tokens: 1 },
          },
        }),
      );
      let index = 0;
      if (turn.text !== undefined) {
        res.write(
          sse("content_block_start", {
            type: "content_block_start",
            index,
            content_block: { type: "text", text: "" },
          }),
        );
        res.write(
          sse("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text: turn.text },
          }),
        );
        res.write(
          sse("content_block_stop", { type: "content_block_stop", index }),
        );
        index++;
      }
      if (turn.toolUse) {
        res.write(
          sse("content_block_start", {
            type: "content_block_start",
            index,
            content_block: {
              type: "tool_use",
              id: `toolu_${at + 1}`,
              name: turn.toolUse.name,
              input: {},
            },
          }),
        );
        res.write(
          sse("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: {
              type: "input_json_delta",
              partial_json: JSON.stringify(turn.toolUse.input),
            },
          }),
        );
        res.write(
          sse("content_block_stop", { type: "content_block_stop", index }),
        );
      }
      res.write(
        sse("message_delta", {
          type: "message_delta",
          delta: { stop_reason: turn.toolUse ? "tool_use" : "end_turn" },
          usage: turn.nullDelta
            ? {
                input_tokens: null,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                output_tokens: usage.output_tokens,
              }
            : { output_tokens: usage.output_tokens },
        }),
      );
      res.end(sse("message_stop", { type: "message_stop" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    turns,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

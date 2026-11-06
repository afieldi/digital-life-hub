import { AiError } from "../src/ai/errors";
import { createVercelGateway } from "../src/ai/providers/vercel";

const schema = { type: "object", properties: { a: { type: "string" } } };
const req = () => ({
  system: "sys",
  prompt: "hello",
  schema,
  model: "some/model",
  signal: new AbortController().signal,
});

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status },
    );
  };
  return { impl, calls };
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    return e as AiError;
  }
  throw new Error("expected rejection");
}

describe("vercel provider", () => {
  test("posts to the Gateway with the key and a json_schema response format", async () => {
    const f = fakeFetch(200, {
      choices: [{ message: { content: '{"a":"b"}' } }],
    });
    const p = createVercelGateway({ apiKey: "k", fetch: f.impl });
    expect(p.id).toBe("vercel");
    const out = await p.complete(req());
    expect(out.raw).toBe('{"a":"b"}');
    expect(f.calls[0]?.url).toBe(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
    );
    expect(f.calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer k",
    });
    const body = JSON.parse(String(f.calls[0]?.init?.body));
    expect(body.response_format.type).toBe("json_schema");
  });

  test("a 401 from the Gateway is provider_unavailable", async () => {
    const f = fakeFetch(401, "nope");
    const e = await codeOf(
      createVercelGateway({ apiKey: "k", fetch: f.impl }).complete(req()),
    );
    expect(e.code).toBe("provider_unavailable");
    expect(e.message).toBe("Vercel AI Gateway isn't set up on the server.");
  });
});

describe("vercel decide", () => {
  const question = {
    name: "actionId",
    instructions: "Pick the command.",
    choices: [
      { value: "leaveRequest", description: "file a request" },
      { value: "escalate", description: "needs the owner" },
    ],
  };
  const decideReq = (over: Record<string, unknown> = {}) => ({
    model: "typesafe-ai/jev",
    input: "Could you chase the vendor?",
    question,
    signal: new AbortController().signal,
    ...over,
  });
  const answer = (over: Record<string, unknown> = {}) => ({
    answers: [
      {
        type: "choice",
        name: "actionId",
        choice: "escalate",
        confidence: 0.4,
        probabilities: [
          { value: "leaveRequest", probability: 0.3 },
          { value: "escalate", probability: 0.7 },
        ],
        ...over,
      },
    ],
    usage: { input_tokens: 342, output_tokens: 40, total_tokens: 382 },
    provider_metadata: { gateway: { cost: "0.000014364" } },
  });

  test("vercel decide posts a choice question to /v1/decisions", async () => {
    const f = fakeFetch(200, answer());
    const out = await createVercelGateway({
      apiKey: "k",
      fetch: f.impl,
    }).decide(decideReq());
    expect(f.calls[0]?.url).toBe("https://ai-gateway.vercel.sh/v1/decisions");
    expect(f.calls[0]?.init?.method).toBe("POST");
    expect(f.calls[0]?.init?.headers).toEqual({
      Authorization: "Bearer k",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(f.calls[0]?.init?.body))).toEqual({
      model: "typesafe-ai/jev",
      input: "Could you chase the vendor?",
      questions: [{ type: "choice", ...question }],
    });
    expect(out).toEqual({
      choice: "escalate",
      confidence: 0.4,
      probabilities: { leaveRequest: 0.3, escalate: 0.7 },
      usage: { input: 342, output: 40, costUsd: 0.000014364 },
    });
  });

  test("decide reads confidence, not the top probability", async () => {
    const f = fakeFetch(200, answer());
    const out = await createVercelGateway({
      apiKey: "k",
      fetch: f.impl,
    }).decide(decideReq());
    expect(out.confidence).toBe(0.4);
    expect(out.confidence).not.toBe(out.probabilities.escalate);
  });

  test("decide rejects a choice outside the supplied values", async () => {
    const f = fakeFetch(200, answer({ choice: "deleteEverything" }));
    const e = await codeOf(
      createVercelGateway({ apiKey: "k", fetch: f.impl }).decide(decideReq()),
    );
    expect(e.code).toBe("bad_output");
  });

  test("decide maps 401 and 5xx like the chat path", async () => {
    const e1 = await codeOf(
      createVercelGateway({
        apiKey: "k",
        fetch: fakeFetch(403, "no").impl,
      }).decide(decideReq()),
    );
    expect(e1.code).toBe("provider_unavailable");
    const e2 = await codeOf(
      createVercelGateway({
        apiKey: "k",
        fetch: fakeFetch(502, "upstream down").impl,
      }).decide(decideReq()),
    );
    expect(e2.code).toBe("provider_error");
    expect(e2.message).toBe(
      "Vercel AI Gateway returned an error: upstream down.",
    );
  });

  test("decide times out", async () => {
    const impl: typeof fetch = (_i, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(init.signal?.reason));
      });
    const e = await codeOf(
      createVercelGateway({ apiKey: "k", fetch: impl, timeoutMs: 10 }).decide(
        decideReq(),
      ),
    );
    expect(e.code).toBe("timeout");
  });
});

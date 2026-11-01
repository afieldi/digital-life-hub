import { AiError, aiErrorMessage, PROVIDER_NAMES } from "../src/ai/errors";
import { createOpenRouter } from "../src/ai/providers/openrouter";
import { FakeProvider } from "../src/testing";

const schema = { type: "object", properties: { a: { type: "string" } } };
const req = (signal = new AbortController().signal) => ({
  system: "sys",
  prompt: "hello",
  schema,
  model: "some/model",
  signal,
});

function fakeFetch(status: number, body: unknown, statusText = "") {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      {
        status,
        statusText,
      },
    );
  };
  return { impl, calls };
}

const okBody = {
  choices: [{ message: { content: '{"a":"b"}' } }],
  usage: { prompt_tokens: 11, completion_tokens: 7, cost: 0.0042 },
};

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    return e as AiError;
  }
  throw new Error("expected rejection");
}

describe("openrouter", () => {
  test("sends the documented request and maps usage", async () => {
    const f = fakeFetch(200, okBody);
    const p = createOpenRouter({ apiKey: "k", fetch: f.impl });
    const out = await p.complete(req());
    expect(out).toEqual({
      raw: '{"a":"b"}',
      usage: { input: 11, output: 7, costUsd: 0.0042 },
    });
    expect(f.calls[0]?.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(f.calls[0]?.init?.method).toBe("POST");
    expect(f.calls[0]?.init?.headers).toEqual({
      Authorization: "Bearer k",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(f.calls[0]?.init?.body))).toEqual({
      model: "some/model",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema },
      },
      usage: { include: true },
    });
  });

  test("usage is omitted when the response has none", async () => {
    const f = fakeFetch(200, { choices: [{ message: { content: "{}" } }] });
    const out = await createOpenRouter({ apiKey: "k", fetch: f.impl }).complete(
      req(),
    );
    expect(out.usage).toBeUndefined();
  });

  test.each([401, 403])("HTTP %i is provider_unavailable", async (status) => {
    const f = fakeFetch(status, "nope");
    const e = await codeOf(
      createOpenRouter({ apiKey: "k", fetch: f.impl }).complete(req()),
    );
    expect(e.code).toBe("provider_unavailable");
    expect(e.message).toBe("OpenRouter isn't set up on the server.");
  });

  test("5xx is provider_error with the first body line", async () => {
    const f = fakeFetch(502, "upstream down\nstack trace");
    const e = await codeOf(
      createOpenRouter({ apiKey: "k", fetch: f.impl }).complete(req()),
    );
    expect(e.code).toBe("provider_error");
    expect(e.message).toBe("OpenRouter returned an error: upstream down.");
  });

  test("empty body falls back to status text", async () => {
    const f = fakeFetch(500, "", "Internal Server Error");
    const e = await codeOf(
      createOpenRouter({ apiKey: "k", fetch: f.impl }).complete(req()),
    );
    expect(e.message).toBe(
      "OpenRouter returned an error: Internal Server Error.",
    );
  });

  test("a rejected fetch is provider_error", async () => {
    const impl: typeof fetch = async () => {
      throw new TypeError("connection refused");
    };
    const e = await codeOf(
      createOpenRouter({ apiKey: "k", fetch: impl }).complete(req()),
    );
    expect(e.code).toBe("provider_error");
    expect(e.message).toBe("OpenRouter returned an error: connection refused.");
  });

  test("missing or empty content is bad_output", async () => {
    for (const body of [
      { choices: [] },
      { choices: [{ message: { content: "" } }] },
      {},
    ]) {
      const f = fakeFetch(200, body);
      const e = await codeOf(
        createOpenRouter({ apiKey: "k", fetch: f.impl }).complete(req()),
      );
      expect(e.code).toBe("bad_output");
    }
  });

  test("a non-JSON 200 body is bad_output", async () => {
    const f = fakeFetch(200, "<html>");
    const e = await codeOf(
      createOpenRouter({ apiKey: "k", fetch: f.impl }).complete(req()),
    );
    expect(e.code).toBe("bad_output");
  });

  test("aborts after timeoutMs with a timeout error", async () => {
    const impl: typeof fetch = (_i, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(init.signal?.reason));
      });
    const e = await codeOf(
      createOpenRouter({ apiKey: "k", fetch: impl, timeoutMs: 10 }).complete(
        req(),
      ),
    );
    expect(e.code).toBe("timeout");
    expect(e.message).toBe("OpenRouter didn't answer within 0.01 seconds.");
  });

  test("honours the caller's signal", async () => {
    const impl: typeof fetch = (_i, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(init.signal?.reason));
      });
    const ac = new AbortController();
    const pending = createOpenRouter({ apiKey: "k", fetch: impl }).complete(
      req(ac.signal),
    );
    ac.abort();
    const e = await codeOf(pending);
    expect(e.code).toBe("provider_error");
  });
});

describe("aiErrorMessage", () => {
  test("names", () => {
    expect(PROVIDER_NAMES).toEqual({
      openrouter: "OpenRouter",
      "claude-cli": "Claude Code",
      "codex-cli": "Codex",
    });
  });

  test("every copy string", () => {
    expect(aiErrorMessage("bad_output", "openrouter")).toBe(
      "OpenRouter's answer wasn't in the expected format, so nothing was changed.",
    );
    expect(aiErrorMessage("timeout", "claude-cli", { seconds: 60 })).toBe(
      "Claude Code didn't answer within 60 seconds.",
    );
    expect(
      aiErrorMessage("provider_unavailable", "openrouter", {
        reason: "no_key",
      }),
    ).toBe("OpenRouter isn't set up on the server.");
    expect(
      aiErrorMessage("provider_unavailable", "codex-cli", {
        reason: "not_installed",
      }),
    ).toBe("Codex isn't installed on this computer.");
    expect(
      aiErrorMessage("provider_unavailable", "claude-cli", {
        reason: "signed_out",
      }),
    ).toBe(
      "Claude Code isn't signed in. Run `claude` once in a terminal to sign in.",
    );
    expect(
      aiErrorMessage("provider_unavailable", "codex-cli", {
        reason: "signed_out",
      }),
    ).toBe("Codex isn't signed in. Run `codex` once in a terminal to sign in.");
    expect(
      aiErrorMessage("provider_error", "codex-cli", { firstLine: "boom" }),
    ).toBe("Codex returned an error: boom.");
    expect(aiErrorMessage("stale", "claude-cli")).toBe(
      "This item changed while Claude Code was working, so nothing was changed.",
    );
    expect(aiErrorMessage("expired", "openrouter")).toBe(
      "This suggestion expired.",
    );
    expect(aiErrorMessage("not_found", "openrouter")).toBe(
      "This item was deleted.",
    );
  });

  test("AiError carries code and message", () => {
    const e = new AiError("expired", "x");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("expired");
    expect(e.message).toBe("x");
  });
});

describe("FakeProvider", () => {
  test("replays the queue in order and records calls", async () => {
    const p = new FakeProvider("openrouter");
    p.queue("one", { error: "timeout" }, { delayMs: 5, raw: "three" });
    expect((await p.complete(req())).raw).toBe("one");
    const e = await codeOf(p.complete(req()));
    expect(e.code).toBe("timeout");
    expect((await p.complete(req())).raw).toBe("three");
    expect(p.calls).toHaveLength(3);
    expect(p.calls[0]?.prompt).toBe("hello");
    expect(p.id).toBe("openrouter");
  });

  test("an empty queue throws", async () => {
    await expect(
      new FakeProvider("claude-cli").complete(req()),
    ).rejects.toThrow(/queue/);
  });
});

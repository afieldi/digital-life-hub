import { audienceAllows } from "../src/audience";

const TASK = "00000000-0000-4000-8000-000000000001";
const REQUEST = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const BOB = { slackUserId: "U_BOB", githubLogin: null };
const run = { asker: BOB, taskId: TASK, requestId: REQUEST };

const op = (
  id: string,
  subject: (input: never) => string | null = () => null,
  audience?: "asker",
) => ({ id, subject, ...(audience ? { audience } : {}) });

const byId = (input: { id: string }) => input.id;

describe("audienceAllows", () => {
  test("an asker operation for the run's own asker, the whole asker", () => {
    const lookup = op("requests.fromSender", () => null, "asker");
    expect(audienceAllows(lookup, { asker: BOB }, run)).toBe(true);
    expect(
      audienceAllows(lookup, { asker: { slackUserId: "U_CAROL" } }, run),
    ).toBe(false);
    // Same Slack id, someone else's GitHub login.
    expect(
      audienceAllows(
        lookup,
        { asker: { slackUserId: "U_BOB", githubLogin: "carol" } },
        run,
      ),
    ).toBe(false);
    expect(audienceAllows(lookup, {}, run)).toBe(false);
    // An asker on an operation that isn't an asker operation counts for nothing.
    expect(audienceAllows(op("x.y"), { asker: BOB }, run)).toBe(false);
  });

  test("an operation on the run's own task or request that names nothing else", () => {
    const update = op("tasks.update", byId as never);
    expect(audienceAllows(update, { id: TASK, title: "x" }, run)).toBe(true);
    expect(audienceAllows(update, { id: REQUEST }, run)).toBe(true);
    expect(audienceAllows(update, { id: OTHER }, run)).toBe(false);
    // Moving another task under its own: the subject is its own, the input names another.
    const addParent = op(
      "tasks.addParent",
      ((i: { parentId: string }) => i.parentId) as never,
    );
    expect(audienceAllows(addParent, { id: OTHER, parentId: TASK }, run)).toBe(
      false,
    );
    expect(
      audienceAllows(update, { id: TASK, position: { after: OTHER } }, run),
    ).toBe(false);
    // No subject, or one that throws, is no subject.
    expect(audienceAllows(op("requests.open"), {}, run)).toBe(false);
    const throws = op("x.y", () => {
      throw new Error("bad");
    });
    expect(audienceAllows(throws, { id: TASK }, run)).toBe(false);
  });

  test("a run with no request owns only its task", () => {
    const update = op("tasks.update", byId as never);
    const noRequest = { ...run, requestId: null };
    expect(audienceAllows(update, { id: TASK }, noRequest)).toBe(true);
    expect(audienceAllows(update, { id: REQUEST }, noRequest)).toBe(false);
  });

  test("filing a request and posting to the source are always allowed", () => {
    expect(audienceAllows(op("requests.file"), { title: "x" }, run)).toBe(true);
    expect(
      audienceAllows(
        op("slack.postToSource"),
        { runId: OTHER, text: "hi" },
        run,
      ),
    ).toBe(true);
    expect(audienceAllows(op("tasks.create"), { title: "x" }, run)).toBe(false);
  });
});

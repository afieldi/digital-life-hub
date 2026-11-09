import { expect, test } from "vitest";
import { setup } from "./setup";

test("settings default to the spec's values", async () => {
  const { caller, close } = await setup();
  expect(await caller.slack.settings({})).toEqual({
    teamId: null,
    botUserId: null,
    ownerSlackId: null,
    ackText: "Got it, I've passed this to Arek.",
    threshold: 0.6,
    appendMinutes: 15,
    interpreter: "typesafe-ai/jev",
    coworkerAi: true,
    seenAt: null,
  });
  await close();
});

test("setSettings changes some and undoes", async () => {
  const { caller, slack, close } = await setup();
  const { result, undo } = await caller.slack.setSettings({
    ownerSlackId: "U1",
    threshold: 0.8,
  });
  expect(result).toMatchObject({ ownerSlackId: "U1", threshold: 0.8 });
  expect(await slack.slack.botSettings({})).toEqual({
    ownerSlackId: "U1",
    teamId: null,
    botUserId: null,
  });
  expect(undo).toBeDefined();
  await close();
});

test("setSettings refuses a threshold of 1.5 and an append window of 0", async () => {
  const { caller, close } = await setup();
  await expect(
    caller.slack.setSettings({ threshold: 1.5 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.slack.setSettings({ appendMinutes: 0 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.slack.setSettings({ appendMinutes: 121 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await close();
});

test("upsertPerson keeps a manual github login", async () => {
  const { caller, slack, close } = await setup();
  await slack.slack.upsertPerson({
    slackUserId: "U2",
    name: "Sam",
    githubLogin: "sam-profile",
  });
  expect(await caller.slack.people({})).toEqual([
    {
      slackUserId: "U2",
      name: "Sam",
      githubLogin: "sam-profile",
      githubFrom: "profile",
    },
  ]);
  await caller.slack.setGithubLogin({ slackUserId: "U2", githubLogin: "sam" });
  await slack.slack.upsertPerson({
    slackUserId: "U2",
    name: "Samuel",
    githubLogin: "other",
  });
  expect(await caller.slack.people({})).toEqual([
    {
      slackUserId: "U2",
      name: "Samuel",
      githubLogin: "sam",
      githubFrom: "manual",
    },
  ]);
  await close();
});

test("only a slack token calls slack operations, and only you the settings", async () => {
  const { caller, slack, close } = await setup();
  await expect(caller.slack.botSettings({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(slack.slack.settings({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await close();
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FetchSecret,
  launchSpec,
  prepareWorkspace,
  reposOf,
  serverEnv,
  wireConnections,
} from "../src/connections";
import { classify, mcpServerKey } from "../src/permissions";
import { buildPrompt } from "../src/prompt";
import { runStart } from "./fixtures";

const SECRETS: Record<string, Record<string, string>> = {
  "github/GitHub work": { token: "ghp_github_secret" },
  "aws/Prod AWS": {
    Version: "1",
    AccessKeyId: "ASIA_TEMP",
    SecretAccessKey: "aws_temp_secret",
    SessionToken: "aws_session_secret",
    Expiration: "2026-11-05T11:00:00.000Z",
  },
  "slack/Slack": { token: "xoxb-slack-secret", team_id: "T0001" },
  "linear/Linear": { token: "lin_api_secret" },
  "gdrive/Drive": { token: "ya29.drive_secret" },
  "mcp/Sentry": {
    command: "npx",
    args: '["-y", "@sentry/mcp-server"]',
    env: '{"SENTRY_TOKEN":"sentry_secret"}',
  },
  "env/Deploy env": { DEPLOY_KEY: "env_secret", REGION: "eu-west-1" },
};
const ALL_SECRET_VALUES = Object.values(SECRETS)
  .flatMap((s) => Object.values(s))
  .filter((v) => v.includes("secret"));

const fetchSecretFake = () =>
  vi.fn<FetchSecret>(async (type, name) => {
    const s = SECRETS[`${type}/${name}`];
    if (!s) throw new Error(`Not granted: ${name}.`);
    return s;
  });

const connections = [
  {
    id: "c1",
    name: "GitHub work",
    type: "github",
    scopeSummary: "repos: acme/web, acme/api",
  },
  { id: "c2", name: "Slack", type: "slack", scopeSummary: "bot in #eng" },
  { id: "c3", name: "Linear", type: "linear", scopeSummary: "team ENG" },
  { id: "c4", name: "Drive", type: "gdrive", scopeSummary: "shared drive" },
  { id: "c5", name: "Sentry", type: "mcp", scopeSummary: "issues" },
  { id: "c6", name: "Deploy env", type: "env", scopeSummary: "DEPLOY_KEY" },
  { id: "c7", name: "Prod AWS", type: "aws", scopeSummary: "read only" },
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "dlh-conn-"));
  dirs.push(d);
  return d;
};

describe("wireConnections", () => {
  it("secrets go to MCP server and SDK env, never the returned container env", async () => {
    const start = runStart({
      connections,
      grantedIds: connections.map((c) => c.id),
    });
    const fetchSecret = fetchSecretFake();
    const before = { ...process.env };

    const w = await wireConnections(start, fetchSecret, {
      workspace: "/workspace",
    });

    // `env` values reach the SDK child's environment, and only through `env`.
    expect(w.env).toMatchObject({
      DEPLOY_KEY: "env_secret",
      REGION: "eu-west-1",
    });
    expect(process.env).toEqual(before);

    // Each MCP connection is a server keyed by `mcpServerKey`, its config free of secrets:
    // the SDK hands the config to its child on the command line.
    expect(Object.keys(w.mcpServers).sort()).toEqual(
      ["Slack", "Linear", "Drive", "Sentry"].map(mcpServerKey).sort(),
    );
    const { env, ...rest } = w;
    for (const s of ALL_SECRET_VALUES) {
      expect(JSON.stringify(rest)).not.toContain(s);
      if (s !== "env_secret") expect(JSON.stringify(env)).not.toContain(s);
    }

    // The runner never fetches the GitHub token or AWS keys: those are fetched on use.
    const fetched = fetchSecret.mock.calls.map(([type]) => type);
    expect(fetched).not.toContain("github");
    expect(fetched).not.toContain("aws");
    expect(fetched).not.toContain("slack");

    // The server process alone gets its token, in its environment.
    const slack = await launchSpec("slack", "Slack", fetchSecret);
    expect(slack.env).toMatchObject({
      SLACK_BOT_TOKEN: "xoxb-slack-secret",
      SLACK_TEAM_ID: "T0001",
    });
    expect(slack.args.join(" ")).not.toContain("secret");
    const linear = await launchSpec("linear", "Linear", fetchSecret);
    expect(linear.env).toEqual({ LINEAR_API_TOKEN: "lin_api_secret" });
    const drive = await launchSpec("gdrive", "Drive", fetchSecret);
    expect(drive.env).toEqual({
      GOOGLE_DRIVE_MCP_ACCESS_TOKEN: "ya29.drive_secret",
    });
    const sentry = await launchSpec("mcp", "Sentry", fetchSecret);
    expect(sentry).toEqual({
      command: "npx",
      args: ["-y", "@sentry/mcp-server"],
      env: { SENTRY_TOKEN: "sentry_secret" },
    });
  });

  it("github clones its listed repos once", async () => {
    const workspace = tempDir();
    const start = runStart({ connections, grantedIds: ["c1", "c7"] });
    const w = await wireConnections(start, fetchSecretFake(), { workspace });

    expect(w.clone).toEqual(["acme/web", "acme/api"]);
    expect(w.gitConfig).toEqual({ "credential.helper": "!dlh-credential git" });
    expect(w.env).toMatchObject({
      DLH_GITHUB_CONNECTION: "GitHub work",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "!dlh-credential git",
    });

    const git = vi.fn(async (args: string[], _env: Record<string, string>) => {
      mkdirSync(args[args.length - 1] as string);
    });
    await prepareWorkspace(w, workspace, { git, log: () => {} });
    await prepareWorkspace(w, workspace, { git, log: () => {} });

    expect(git.mock.calls.map(([args]) => args)).toEqual([
      [
        "clone",
        "--",
        "https://github.com/acme/web.git",
        join(workspace, "web"),
      ],
      [
        "clone",
        "--",
        "https://github.com/acme/api.git",
        join(workspace, "api"),
      ],
    ]);
    // The clone asks the credential helper, like the agent's own git does.
    expect(git.mock.calls[0]?.[1]).toMatchObject({
      GIT_CONFIG_KEY_0: "credential.helper",
    });

    // AWS: a profile per granted connection, its keys fetched on use.
    const aws = readFileSync(join(workspace, ".aws", "config"), "utf8");
    expect(aws).toContain(
      "[default]\ncredential_process = dlh-credential aws 'Prod AWS'",
    );
    expect(aws).toContain(
      "[profile Prod_AWS]\ncredential_process = dlh-credential aws 'Prod AWS'",
    );
    expect(w.env.AWS_CONFIG_FILE).toBe(join(workspace, ".aws", "config"));
  });

  it("a disabled connection isn't wired and becomes a grant on use", async () => {
    const workspace = tempDir();
    // Only GitHub is granted: Slack, Linear, AWS and env are disabled for this run.
    const start = runStart({ connections, grantedIds: ["c1"] });
    const fetchSecret = fetchSecretFake();
    const w = await wireConnections(start, fetchSecret, { workspace });

    expect(w.mcpServers).toEqual({});
    expect(fetchSecret).not.toHaveBeenCalled();
    expect(w.env.DEPLOY_KEY).toBeUndefined();
    expect(w.env.AWS_CONFIG_FILE).toBeUndefined();
    await prepareWorkspace(w, workspace, {
      git: async (args) => mkdirSync(args[args.length - 1] as string),
      log: () => {},
    });
    expect(existsSync(join(workspace, ".aws", "config"))).toBe(false);

    // It is offered to the agent, and its tools (were they there) would ask.
    expect(buildPrompt(start)).toMatch(
      /You can ask for:\n(- .+\n)*- Slack \(slack\)/,
    );
    expect(
      classify(
        `mcp__${mcpServerKey("Slack")}__slack_post_message`,
        { channel_id: "C1" },
        {
          connections: [],
          sourceUrl: null,
          cwd: workspace,
          currentBranch: () => null,
        },
      ),
    ).toBe("ask");
  });

  it("a GitHub connection uses the first granted one by name", async () => {
    const start = runStart({
      connections: [
        { id: "a", name: "Zeta", type: "github", scopeSummary: "repos: z/one" },
        {
          id: "b",
          name: "Alpha",
          type: "github",
          scopeSummary: "repos: a/two",
        },
      ],
      grantedIds: ["a", "b"],
    });
    const w = await wireConnections(start, fetchSecretFake(), {
      workspace: "/workspace",
    });
    expect(w.env.DLH_GITHUB_CONNECTION).toBe("Alpha");
    expect(w.clone).toEqual(["a/two"]);
  });
});

describe("serverEnv", () => {
  it("a server gets a minimal environment and its own variables", () => {
    const parent = {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      NODE_OPTIONS: "--max-old-space-size=512",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
      // The SDK child's: an env connection's secret, git and model settings.
      DEPLOY_KEY: "env-connection-secret",
      ANTHROPIC_AUTH_TOKEN: "dlh-run",
      GIT_CONFIG_COUNT: "1",
      DLH_GITHUB_CONNECTION: "GitHub work",
    };
    expect(
      serverEnv(parent, { SLACK_BOT_TOKEN: "xoxb", PATH: "/opt" }),
    ).toEqual({
      PATH: "/opt",
      HOME: "/home/runner",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      NODE_OPTIONS: "--max-old-space-size=512",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
      SLACK_BOT_TOKEN: "xoxb",
    });
    expect(serverEnv({}, {})).toEqual({});
  });
});

describe("reposOf", () => {
  it("reads owner/repo pairs and drops anything else", () => {
    expect(reposOf("repos: acme/web, acme/api")).toEqual([
      "acme/web",
      "acme/api",
    ]);
    expect(
      reposOf("Fine-grained. Repos: acme/web acme/api; read+write"),
    ).toEqual(["acme/web", "acme/api"]);
    expect(reposOf("repos: ../etc, acme/.., -x/y, ok/fine")).toEqual([
      "ok/fine",
    ]);
    expect(reposOf("no repos listed")).toEqual([]);
  });
});

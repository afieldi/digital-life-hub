import { inputHash } from "@dlh/agent-protocol";
import { hubCallHash } from "@dlh/core/hash";
import {
  Approvals,
  askedInput,
  type ClassifyContext,
  classify,
} from "../src/permissions";
import { hubOperations } from "../src/tools";

function ctx(overrides: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    connections: [
      { name: "Slack", type: "slack" },
      { name: "Linear", type: "linear" },
    ],
    sourceUrl: "https://acme.slack.com/archives/C024BE91L/p1700000000000100",
    cwd: "/workspace/web",
    currentBranch: () => "feature",
    ...overrides,
  };
}

const bash = (command: string, c = ctx()) => classify("Bash", { command }, c);

describe("classify", () => {
  it("built-in tools and the run's own tools are alone", () => {
    expect(classify("Read", { file_path: "/workspace/a" }, ctx())).toBe(
      "alone",
    );
    expect(classify("Edit", { file_path: "/workspace/a" }, ctx())).toBe(
      "alone",
    );
    expect(bash("pnpm test && git commit -am wip")).toBe("alone");
    expect(classify("WebFetch", { url: "https://x.dev" }, ctx())).toBe("alone");
    expect(classify("WebSearch", { query: "x" }, ctx())).toBe("alone");
    for (const t of [
      "mcp__dlh__hub__tasks_create",
      "mcp__dlh__finish_task",
      "mcp__dlh__give_up",
      "mcp__dlh__request_connection",
    ]) {
      expect(classify(t, {}, ctx()), t).toBe("alone");
    }
  });

  it("main pushes and merges are asks in every spelling", () => {
    const asks = [
      "git push origin HEAD:main",
      "git push -f origin main",
      "git push origin main:main",
      "git push origin x:main",
      "git push origin refs/heads/main",
      "git push origin +feature:master",
      "cd /workspace/web && git push --force origin main",
      "git -C /workspace/web push origin HEAD:refs/heads/main",
      "bash -c 'git push origin main'",
      "gh pr merge 3 --admin",
      "gh pr merge 3 --squash",
      "gh -R acme/web pr merge 3",
      "gh api -X PUT repos/o/r/pulls/3/merge",
      "gh api --method=POST repos/o/r/pulls",
      "gh api repos/o/r/pulls/3/merge -f merge_method=squash",
      // Shell expansion in the refspec.
      'cd repo && git push origin "$(git branch --show-current)"',
      "B=main; git push origin $B",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion, not a template
      "git push origin ${BR:-main}",
      "git push origin `git branch --show-current`",
      "git push origin 'ma*'",
      // Compound commands.
      "if true; then git push origin main; fi",
      "for b in main; do git push origin main; done",
      "{ git push origin main; }",
      "! git push origin main",
      // Wrappers and shell option clusters.
      "timeout 60 git push origin main",
      "nice git push origin main",
      "nice -n 5 git push origin main",
      "echo main | xargs git push origin",
      "env -i git push origin main",
      "bash -lc 'git push origin main'",
      "bash -ec 'git push origin main'",
      // Mentions a push or merge the parser can't clear.
      "git commit -m wip && GIT_DIR=.git command -p git push origin main",
      "xargs -I{} git push origin {} < branches.txt",
      "gh pr list | grep merge && gh pr merge",
    ];
    for (const c of asks) expect(bash(c), c).toBe("ask");

    const onMain = ctx({ currentBranch: () => "main" });
    expect(bash("git push", onMain)).toBe("ask");
    expect(bash("git push origin", onMain)).toBe("ask");
    expect(bash("git push origin HEAD", onMain)).toBe("ask");

    expect(bash("git push -u origin feature")).toBe("alone");
    expect(bash("git status && git push -u origin feature")).toBe("alone");
    expect(bash("bash -lc 'git push -u origin feature'")).toBe("alone");
    expect(bash("timeout 60 git push -u origin feature")).toBe("alone");
    expect(bash("git push origin HEAD:feature")).toBe("alone");
    expect(bash("git push -f origin feature")).toBe("alone");
    expect(bash("git push")).toBe("alone");
    expect(bash("gh pr create --fill")).toBe("alone");
    expect(bash("gh api repos/o/r/pulls/3")).toBe("alone");
  });

  it("a git subcommand or gh verb the parser can't read asks", () => {
    for (const c of [
      "git $(printf pu; printf sh) origin main",
      'git "$CMD" origin main',
      "git `echo push` origin main",
      "git -C /workspace/web $X origin main",
      "gh pr $(echo bWVyZ2U= | base64 -d) 3",
      'gh pr "$VERB" 3',
      "gh $(echo pr) merge 3",
      "gh -R acme/web pr `echo m`erge 3",
    ]) {
      expect(bash(c), c).toBe("ask");
    }
    expect(bash("git log --format=%H -n1")).toBe("alone");
    expect(bash('gh pr view 3 --json title -q ".title"')).toBe("alone");
  });

  it("heads/main is main", () => {
    expect(bash("git push origin HEAD:heads/main")).toBe("ask");
    expect(bash("git push origin feature:heads/master")).toBe("ask");
    expect(bash("git push origin HEAD:heads/feature")).toBe("alone");
  });

  it("a push whose branch can't be told asks", () => {
    expect(bash("git push", ctx({ currentBranch: () => null }))).toBe("ask");
  });

  it("a Slack post is alone only to the request's channel", () => {
    const post = (channel_id: string, c = ctx()) =>
      classify(
        "mcp__Slack__slack_post_message",
        { channel_id, text: "On it" },
        c,
      );
    expect(post("C024BE91L")).toBe("alone");
    expect(post("C999OTHER")).toBe("ask");
    expect(post("C024BE91L", ctx({ sourceUrl: null }))).toBe("ask");
    expect(
      classify(
        "mcp__Slack__slack_reply_to_thread",
        { channel_id: "C024BE91L", thread_ts: "1", text: "x" },
        ctx(),
      ),
    ).toBe("alone");
    // Reads are alone anywhere.
    expect(
      classify(
        "mcp__Slack__slack_get_channel_history",
        { channel_id: "C999OTHER" },
        ctx(),
      ),
    ).toBe("alone");
  });

  it("MCP reads are alone and writes ask", () => {
    expect(classify("mcp__Linear__list_issues", {}, ctx())).toBe("alone");
    expect(classify("mcp__Linear__search_issues", {}, ctx())).toBe("alone");
    expect(classify("mcp__Linear__create_issue", {}, ctx())).toBe("ask");
    expect(classify("mcp__Linear__update_issue", {}, ctx())).toBe("ask");
  });

  it("an unknown MCP tool asks", () => {
    expect(classify("mcp__mystery__list_things", {}, ctx())).toBe("ask");
    expect(classify("TotallyNewTool", {}, ctx())).toBe("ask");
  });
});

describe("approvals", () => {
  it("an approval allows that exact action once", () => {
    const approvals = new Approvals();
    const merge = { command: "gh pr merge 3" };
    approvals.allowOnce("Bash", inputHash("Bash", merge));

    expect(
      approvals.take("Bash", inputHash("Bash", { command: "gh pr merge 4" })),
    ).toBe(false);
    expect(approvals.take("Other", inputHash("Bash", merge))).toBe(false);
    expect(approvals.take("Bash", inputHash("Bash", merge))).toBe(true);
    expect(approvals.take("Bash", inputHash("Bash", merge))).toBe(false);
  });
});

describe("asked input", () => {
  const tool = "mcp__dlh__hub__requests_fromSender";
  const asker = { slackUserId: "U1", githubLogin: null };

  it("a hub call is asked and hashed as its operation parses it", () => {
    const raw = { asker, junk: 1 };
    expect(askedInput(tool, raw)).toEqual({ asker });
    const op = hubOperations().find((o) => o.id === "requests.fromSender");
    if (!op) throw new Error("no requests.fromSender hub tool");
    // What the API's run guard hashes for the same call.
    expect(inputHash(tool, askedInput(tool, raw))).toBe(hubCallHash(op, raw));
  });

  it("other tools, and input the operation refuses, are left as sent", () => {
    const bash = { command: "ls", junk: 1 };
    expect(askedInput("Bash", bash)).toBe(bash);
    const bad = { asker: { slackUserId: "" } };
    expect(askedInput(tool, bad)).toBe(bad);
  });
});

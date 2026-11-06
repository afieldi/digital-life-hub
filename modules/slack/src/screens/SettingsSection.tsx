import { useModuleApi, useModuleWrite } from "@dlh/client";
import {
  Button,
  EmptyState,
  ItemRow,
  QueryState,
  SectionCard,
  Switch,
  TextField,
} from "@dlh/ui";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { SlackRouter } from "../server";

const KEYS = [
  ["slack", "settings"],
  ["slack", "people"],
] as const;
const WRITE = { queryKeys: KEYS, conflictMessage: "Changed since" } as const;

/** The settings as the form holds them: every field text, until saved. */
type Draft = {
  ownerSlackId: string;
  teamId: string;
  botUserId: string;
  ackText: string;
  threshold: string;
  appendMinutes: string;
  interpreter: string;
  coworkerAi: boolean;
};

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

/** The threshold as a number, or null when blank or not 0 to 1 (a blank field is not 0). */
function parseThreshold(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function SettingsForm() {
  const api = useModuleApi<SlackRouter>("slack");
  const write = useModuleWrite(WRITE);
  const query = useQuery({
    queryKey: ["slack", "settings"],
    queryFn: () => api.settings.query({}),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    const s = query.data;
    if (s && draft === null) {
      setDraft({
        ownerSlackId: s.ownerSlackId ?? "",
        teamId: s.teamId ?? "",
        botUserId: s.botUserId ?? "",
        ackText: s.ackText,
        threshold: String(s.threshold),
        appendMinutes: String(s.appendMinutes),
        interpreter: s.interpreter,
        coworkerAi: s.coworkerAi,
      });
    }
  }, [query.data, draft]);
  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <QueryState query={query} errorTitle="Couldn't load Slack settings">
      {() =>
        draft && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const threshold = parseThreshold(draft.threshold);
              if (threshold === null) return;
              void write({
                op: "slack.setSettings",
                summary: "Slack settings saved",
                verb: "save Slack settings",
                call: () =>
                  api.setSettings.mutate({
                    ownerSlackId: orNull(draft.ownerSlackId),
                    teamId: orNull(draft.teamId),
                    botUserId: orNull(draft.botUserId),
                    ackText: draft.ackText,
                    threshold,
                    appendMinutes: Number(draft.appendMinutes),
                    interpreter: draft.interpreter.trim(),
                    coworkerAi: draft.coworkerAi,
                  }),
              });
            }}
          >
            <TextField
              label="Your Slack user ID"
              description="The bot answers no one until this is set."
              value={draft.ownerSlackId}
              onChange={set("ownerSlackId")}
            />
            <TextField
              label="Workspace ID"
              value={draft.teamId}
              onChange={set("teamId")}
            />
            <TextField
              label="Bot user ID"
              value={draft.botUserId}
              onChange={set("botUserId")}
            />
            <TextField
              label="Acknowledgement"
              description="What a coworker sees once their message is filed."
              value={draft.ackText}
              onChange={set("ackText")}
            />
            <TextField
              label="Threshold"
              description="How sure the interpreter must be to act without asking you (0 to 1)."
              inputMode="decimal"
              value={draft.threshold}
              onChange={set("threshold")}
              isInvalid={parseThreshold(draft.threshold) === null}
              errorMessage="Enter a number from 0 to 1."
            />
            <TextField
              label="Append window (minutes)"
              description="How long a later message joins the sender's open request (1 to 120)."
              inputMode="numeric"
              value={draft.appendMinutes}
              onChange={set("appendMinutes")}
            />
            <TextField
              label="Interpreter model"
              description="An AI Gateway model id."
              value={draft.interpreter}
              onChange={set("interpreter")}
            />
            <Switch isSelected={draft.coworkerAi} onChange={set("coworkerAi")}>
              Coworker messages use AI
            </Switch>
            <Button type="submit" variant="solid">
              Save
            </Button>
          </form>
        )
      }
    </QueryState>
  );
}

function PersonRow({
  person,
}: {
  person: {
    slackUserId: string;
    name: string;
    githubLogin: string | null;
    githubFrom: "profile" | "manual";
  };
}) {
  const api = useModuleApi<SlackRouter>("slack");
  const write = useModuleWrite(WRITE);
  const [login, setLogin] = useState(person.githubLogin ?? "");
  useEffect(() => setLogin(person.githubLogin ?? ""), [person.githubLogin]);
  return (
    <ItemRow
      title={person.name || person.slackUserId}
      meta={person.githubFrom === "manual" ? "Set by you" : "From profile"}
      trailing={
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void write({
              op: "slack.setGithubLogin",
              summary: "GitHub login saved",
              verb: "save the GitHub login",
              call: () =>
                api.setGithubLogin.mutate({
                  slackUserId: person.slackUserId,
                  githubLogin: orNull(login),
                }),
            });
          }}
        >
          <TextField
            label={`GitHub login for ${person.name || person.slackUserId}`}
            value={login}
            onChange={setLogin}
          />
          <Button type="submit">Save</Button>
        </form>
      }
    />
  );
}

function People() {
  const api = useModuleApi<SlackRouter>("slack");
  const query = useQuery({
    queryKey: ["slack", "people"],
    queryFn: () => api.people.query({}),
  });
  return (
    <QueryState
      query={query}
      errorTitle="Couldn't load people"
      isEmpty={query.data?.length === 0}
      empty={<EmptyState icon={Users} title="No one yet" />}
    >
      {() =>
        query.data?.map((p) => <PersonRow key={p.slackUserId} person={p} />)
      }
    </QueryState>
  );
}

/** Settings → Slack: how the bot answers, and the people it has met. */
export function SlackSettings() {
  return (
    <>
      <SectionCard title="Slack">
        <SettingsForm />
      </SectionCard>
      <SectionCard title="Slack people">
        <People />
      </SectionCard>
    </>
  );
}

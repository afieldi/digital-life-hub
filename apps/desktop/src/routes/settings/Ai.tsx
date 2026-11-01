import type { AiLogEntry, AiProviderId } from "@dlh/core";
import {
  Button,
  Chip,
  ComboBox,
  ComboBoxItem,
  ItemRow,
  TextField,
  toast,
} from "@dlh/ui";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type Key, useState } from "react";
import { ALL_ACTIONS } from "../../ai/actions";
import {
  type CliProviderId,
  cliPathKey,
  cliPathOverride,
  cliStatus,
  type StoredCliStatus,
  saveCliStatus,
  storedCliStatus,
} from "../../ai/cli";
import { PROVIDER_NAMES } from "../../ai/providers";
import { undoAiRequest } from "../../ai/useAiRequest";
import { useTRPC, useTRPCClient } from "../../api/client";
import { formatLastActive } from "./lastActive";

const PROVIDERS: AiProviderId[] = ["openrouter", "claude-cli", "codex-cli"];
const CLI_PROVIDERS: CliProviderId[] = ["claude-cli", "codex-cli"];
const KINDS = { ask: "Ask", suggest: "Suggest", do: "Do" } as const;

function cliLabel(
  status: StoredCliStatus | undefined,
  failed: boolean,
): string {
  if (failed) return "Could not check";
  if (!status) return "Checking…";
  if (!status.installed) return "Not installed";
  return status.signedIn ? "Ready" : "Signed out";
}

function CliProviderRow({ provider }: { provider: CliProviderId }) {
  const status = useQuery({
    queryKey: ["ai", "cliStatus", provider],
    queryFn: async (): Promise<StoredCliStatus> => {
      const checked = {
        ...(await cliStatus(provider, cliPathOverride(provider))),
        checkedAt: new Date().toISOString(),
      };
      saveCliStatus(provider, checked);
      return checked;
    },
    initialData: () => storedCliStatus(provider) ?? undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <ItemRow
      title={PROVIDER_NAMES[provider]}
      meta={[
        cliLabel(status.data, status.isError),
        status.isFetching && status.data
          ? "Checking…"
          : status.data
            ? `Last checked ${formatWhen(status.data.checkedAt, new Date())}`
            : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      trailing={
        <Button
          variant="ghost"
          isDisabled={status.isFetching}
          onPress={() => void status.refetch()}
        >
          Check again
        </Button>
      }
    />
  );
}

const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

function CliPathField({ provider }: { provider: CliProviderId }) {
  const queryClient = useQueryClient();
  const [invalid, setInvalid] = useState(false);
  const example =
    provider === "claude-cli"
      ? "/Users/you/.local/bin/claude"
      : "/Users/you/.local/bin/codex";
  return (
    <TextField
      label={`${PROVIDER_NAMES[provider]} program path`}
      description={`Use the full path, e.g. ${example}. Leave empty to find it automatically. Kept on this device.`}
      errorMessage={
        invalid ? "Enter the full path, starting with /" : undefined
      }
      isInvalid={invalid}
      defaultValue={cliPathOverride(provider) ?? ""}
      onChange={() => setInvalid(false)}
      onBlur={(e) => {
        const value = e.target.value.trim();
        if (value !== "" && !ABSOLUTE_PATH.test(value)) {
          setInvalid(true);
          return;
        }
        if (value === (cliPathOverride(provider) ?? "")) return;
        try {
          if (value) localStorage.setItem(cliPathKey(provider), value);
          else localStorage.removeItem(cliPathKey(provider));
        } catch {
          toast("Could not save the path on this device", { tone: "error" });
          return;
        }
        void queryClient.invalidateQueries({
          queryKey: ["ai", "cliStatus", provider],
        });
      }}
    />
  );
}

function formatWhen(iso: string, now: Date): string {
  return now.getTime() - new Date(iso).getTime() < 60_000
    ? "just now"
    : formatLastActive(iso, now);
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatResult(e: AiLogEntry): string {
  const base = e.status.charAt(0).toUpperCase() + e.status.slice(1);
  return e.errorCode ? `${base} (${e.errorCode.replaceAll("_", " ")})` : base;
}

function entryMeta(e: AiLogEntry, now: Date): string {
  const ago = formatWhen(e.createdAt, now);
  const when = ago.charAt(0).toUpperCase() + ago.slice(1);
  const tokens =
    e.inputTokens !== null || e.outputTokens !== null
      ? `${(e.inputTokens ?? 0) + (e.outputTokens ?? 0)} tokens`
      : null;
  return [
    when,
    KINDS[e.kind],
    [PROVIDER_NAMES[e.provider], e.model].filter(Boolean).join(" "),
    e.durationMs !== null ? formatDuration(e.durationMs) : null,
    tokens,
    e.costUsd !== null ? `$${e.costUsd.toFixed(4)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function RecentRequests() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const log = useInfiniteQuery(
    trpc.ai.log.list.infiniteQueryOptions(
      {},
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
  const undo = useMutation({
    mutationFn: (requestId: string) => undoAiRequest(client, requestId),
    onSuccess: (summary) => {
      toast(summary);
      return log.refetch();
    },
    onError: (e) => toast(e.message, { tone: "error" }),
  });
  const now = new Date();
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <section
      aria-labelledby="ai-recent"
      className="glass-panel flex flex-col gap-3 p-6"
    >
      <h2 id="ai-recent" className="text-[17px] font-semibold">
        Recent requests
      </h2>
      {log.isError ? (
        <p role="alert" className="text-sm text-ink-secondary">
          Could not load recent requests.
        </p>
      ) : null}
      {log.data && entries.length === 0 ? (
        <p className="text-sm text-ink-tertiary">No requests yet.</p>
      ) : null}
      <div className="flex flex-col">
        {entries.map((e) => (
          <ItemRow
            key={e.id}
            title={
              ALL_ACTIONS.find((a) => a.id === e.actionId)?.label ?? e.actionId
            }
            meta={entryMeta(e, now)}
            chips={<Chip kind="type">{formatResult(e)}</Chip>}
            trailing={
              e.canUndo ? (
                <Button
                  variant="ghost"
                  isDisabled={undo.isPending}
                  onPress={() => undo.mutate(e.id)}
                >
                  Undo
                </Button>
              ) : undefined
            }
          />
        ))}
      </div>
      {log.hasNextPage ? (
        <div>
          <Button
            variant="glass"
            isDisabled={log.isFetchingNextPage}
            onPress={() => void log.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function Ai() {
  const trpc = useTRPC();
  const settings = useQuery(trpc.ai.settings.get.queryOptions());
  const [error, setError] = useState<string | null>(null);
  const save = useMutation(
    trpc.ai.settings.set.mutationOptions({
      onMutate: () => setError(null),
      onSuccess: () => {
        setError(null);
        return settings.refetch();
      },
      onError: () => setError("Could not save that. Try again."),
    }),
  );
  const data = settings.data;
  const openrouter = data?.providers.find((p) => p.id === "openrouter");

  return (
    <>
      <section
        aria-labelledby="ai-heading"
        className="glass-panel flex flex-col gap-4 p-6"
      >
        <h2 id="ai-heading" className="text-[17px] font-semibold">
          AI
        </h2>
        {settings.isError ? (
          <p role="alert" className="text-sm text-ink-secondary">
            Could not load AI settings.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-ink-secondary">
            {error}
          </p>
        ) : null}
        {data ? (
          <>
            <ComboBox
              label="Default provider"
              items={PROVIDERS.map((id) => ({ id, name: PROVIDER_NAMES[id] }))}
              selectedKey={data.defaultProvider}
              onSelectionChange={(key: Key | null) => {
                if (key && key !== data.defaultProvider) {
                  save.mutate({ defaultProvider: key as AiProviderId });
                }
              }}
            >
              {(p) => <ComboBoxItem id={p.id}>{p.name}</ComboBoxItem>}
            </ComboBox>
            <div className="flex flex-col">
              <ItemRow
                title={PROVIDER_NAMES.openrouter}
                meta={
                  openrouter?.available ? "Ready" : "Not set up on the server"
                }
              />
              {CLI_PROVIDERS.map((p) => (
                <CliProviderRow key={p} provider={p} />
              ))}
            </div>
            <TextField
              label="OpenRouter model"
              description="Leave empty to use the server's default."
              defaultValue={data.openrouterModel ?? ""}
              onBlur={(e) => {
                const value = e.target.value.trim() || null;
                if (value !== data.openrouterModel) {
                  save.mutate({ openrouterModel: value });
                }
              }}
            />
            <details className="flex flex-col gap-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-secondary">
                Advanced
              </summary>
              <div className="flex flex-col gap-4 pt-2">
                <ComboBox
                  label="Interpreter"
                  items={[{ id: "keywords", name: "Keywords" }]}
                  selectedKey={data.interpreter}
                  onSelectionChange={(key: Key | null) => {
                    if (key === "keywords" && key !== data.interpreter) {
                      save.mutate({ interpreter: "keywords" });
                    }
                  }}
                >
                  {(i) => <ComboBoxItem id={i.id}>{i.name}</ComboBoxItem>}
                </ComboBox>
                {CLI_PROVIDERS.map((p) => (
                  <CliPathField key={p} provider={p} />
                ))}
              </div>
            </details>
          </>
        ) : null}
      </section>
      <RecentRequests />
    </>
  );
}

/** Shorter values are left alone: they'd match ordinary text. */
const MIN_LENGTH = 8;
const REDACTED = "[redacted]";
/** `credential_process` fields that aren't secret. */
const NOT_SECRET = new Set(["Version", "Expiration"]);

/**
 * Remembers the secret values served to one run and takes them out of what
 * the run reports: its events (shell output can print them, e.g. `env`), its
 * questions and its report, all stored by the API and shown in the app.
 */
export function createRedactor() {
  let values: string[] = [];

  const add = (v: string) => {
    if (v.length >= MIN_LENGTH && !values.includes(v)) {
      // Longest first, so a secret containing another goes whole.
      values = [...values, v].sort((a, b) => b.length - a.length);
    }
  };

  /** Every string in a value, so an `env` JSON's own values count too. */
  const addAll = (value: unknown) => {
    if (typeof value === "string") {
      add(value);
      const s = value.trim();
      if (s.startsWith("{") || s.startsWith("[")) {
        try {
          addAll(JSON.parse(s));
        } catch {}
      }
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value)) addAll(v);
    }
  };

  const text = (s: string) =>
    values.reduce((out, v) => out.split(v).join(REDACTED), s);

  const deep = <T>(value: T): T => {
    if (typeof value === "string") return text(value) as T;
    if (Array.isArray(value)) return value.map(deep) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, deep(v)]),
      ) as T;
    }
    return value;
  };

  return {
    /** A secret as served: each of its values (bar AWS's expiry and version). */
    served(secret: Record<string, string>) {
      for (const [k, v] of Object.entries(secret)) {
        if (!NOT_SECRET.has(k)) addAll(v);
      }
    },
    text,
    deep,
  };
}

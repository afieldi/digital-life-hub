type Field = { value?: string; label?: string };

/**
 * The GitHub login on a Slack profile: the custom field labelled "GitHub"
 * (any case), whether it holds a login, an @login or a profile URL. `null`
 * when the profile has none.
 */
export function githubLogin(
  fields: Record<string, Field> | null | undefined,
): string | null {
  const field = Object.values(fields ?? {}).find(
    (f) => f.label?.trim().toLowerCase() === "github",
  );
  const login = field?.value
    ?.trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");
  return login || null;
}

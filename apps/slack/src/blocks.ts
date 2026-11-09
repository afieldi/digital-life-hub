export type Button = { label: string; value: string };

/** Slack's limit on a button's `value`. */
const MAX_VALUE = 2000;

/**
 * A message's text, with one button per entry under it; no buttons, no blocks.
 * A button whose value is over Slack's limit is dropped (and logged), never cut.
 */
export function blocksFor(
  text: string,
  allButtons?: Button[],
  log?: (line: string) => void,
): { text: string; blocks?: unknown[] } {
  const buttons = allButtons?.filter((b) => {
    if (b.value.length <= MAX_VALUE) return true;
    log?.(`button "${b.label}" dropped: value over ${MAX_VALUE} characters`);
    return false;
  });
  if (!buttons?.length) return { text };
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: buttons.map((b, i) => ({
          type: "button",
          text: { type: "plain_text", text: b.label },
          action_id: `dlh_${i}`,
          value: b.value,
        })),
      },
    ],
  };
}

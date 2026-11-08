export type Button = { label: string; value: string };

/** Slack's limit on a button's `value`. */
const MAX_VALUE = 2000;

/** A message's text, with one button per entry under it; no buttons, no blocks. */
export function blocksFor(
  text: string,
  buttons?: Button[],
): { text: string; blocks?: unknown[] } {
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
          value: b.value.slice(0, MAX_VALUE),
        })),
      },
    ],
  };
}

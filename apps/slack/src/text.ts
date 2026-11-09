/**
 * Slack's message markup as plain text, as a person reads it: a link is its
 * URL (`<https://x|x>` and `<https://x>` both become `https://x`, so the agent
 * gets the real address), a channel is `#name`, an email is the address, and
 * `&lt;` `&gt;` `&amp;` are unescaped. User mentions stay as Slack wrote them.
 */
export function plainText(text: string): string {
  return text
    .replace(/<(#C[A-Z0-9]+)\|([^>]*)>/g, (_, _id, name) => `#${name}`)
    .replace(/<mailto:([^|>]+)(\|[^>]*)?>/g, (_, address) => address)
    .replace(/<((?:https?|ftp):\/\/[^|>]+)(\|[^>]*)?>/g, (_, url) => url)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

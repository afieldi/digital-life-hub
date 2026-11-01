import type { Phrasing } from "../src/ai/suite";

const ITEM = "test";

const p = (
  text: string,
  actionId: string,
  kind: Phrasing["kind"],
  itemType: string | null = ITEM,
): Phrasing => ({ text, itemType, actionId, kind });

/** Labelled phrasings for Core's actions: text, item on screen, expected action and kind. */
export const corePhrasings: Phrasing[] = [
  // retitle, Do
  p("give this a better title", "retitle", "do"),
  p("rename this", "retitle", "do"),
  p("rename it to something clearer", "retitle", "do"),
  p("please rename this", "retitle", "do"),
  p("can you give this a better title?", "retitle", "do"),
  p("make the title shorter", "retitle", "do"),
  p("change the title", "retitle", "do"),
  p("name it something better", "retitle", "do"),
  p("give this a shorter, more formal title", "retitle", "do"),
  p("could you rename this to match the others", "retitle", "do"),
  // retitle, Suggest
  p("suggest a few titles", "retitle", "suggest"),
  p("what's a better title?", "retitle", "suggest"),
  p("what would be a good title for this", "retitle", "suggest"),
  p("title ideas", "retitle", "suggest"),
  p("give me some options for the title", "retitle", "suggest"),
  p("don't rename it, just fix typos", "retitle", "suggest"),
  p("never change the title", "retitle", "suggest"),
  p("is there a better title?", "retitle", "suggest"),
  // delete, Suggest (never Do)
  p("delete this", "delete", "suggest"),
  p("remove this", "delete", "suggest"),
  p("get rid of this", "delete", "suggest"),
  p("please delete this", "delete", "suggest"),
  p("trash it", "delete", "suggest"),
  p("can you delete this?", "delete", "suggest"),
  p("delete this item", "delete", "suggest"),
  p("delte this", "delete", "suggest"),
  // answer, Ask
  p("summarise this", "answer", "ask"),
  p("summarize this note", "answer", "ask"),
  p("sumarise this", "answer", "ask"),
  p("what's left on this?", "answer", "ask"),
  p("explain this", "answer", "ask"),
  p("explain why this matters", "answer", "ask"),
  p("why is this here?", "answer", "ask"),
  p("how does this work", "answer", "ask"),
  p("tell me about this", "answer", "ask"),
  p("can you summarise this?", "answer", "ask"),
  p("can you tell me what the title means?", "retitle", "suggest"),
  p("please explain the title", "answer", "ask"),
  p("delete this please", "delete", "suggest"),
  p("what links to this?", "answer", "ask"),
  p("is this done?", "answer", "ask"),
  p("hmm", "answer", "ask"),
  p("hello there", "answer", "ask"),
  // no item on screen: only `answer` applies
  p("summarise this", "answer", "ask", null),
  p("what's on my plate?", "answer", "ask", null),
  p("give this a better title", "answer", "ask", null),
  p("delete this", "answer", "ask", null),
  p("hmm", "answer", "ask", null),
];

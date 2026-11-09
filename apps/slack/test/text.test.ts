import { expect, test } from "vitest";
import { plainText } from "../src/text";

test("a labelled link becomes its URL", () => {
  expect(
    plainText(
      "<https://github.com/acme/app/pull/42|github.com/acme/app/pull/42>",
    ),
  ).toBe("https://github.com/acme/app/pull/42");
});

test("a bare link, an email and a channel read as a person sees them", () => {
  expect(
    plainText(
      "see <https://x.dev/a?b=1&amp;c=2> and mail <mailto:a@b.co|a@b.co> in <#C123ABC|eng>",
    ),
  ).toBe("see https://x.dev/a?b=1&c=2 and mail a@b.co in #eng");
});

test("escaped angle brackets are unescaped, and user mentions stay", () => {
  expect(plainText("if a &lt; b &amp;&amp; c &gt; d ask <@U123>")).toBe(
    "if a < b && c > d ask <@U123>",
  );
});

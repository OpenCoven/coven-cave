import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCitationsDirective } from "./citations-directive.ts";
import { parseCitations } from "./citations.ts";

test("the directive teaches the footnote syntax and stays non-visible", () => {
  const d = buildCitationsDirective();
  assert.match(d, /^<citations>/, "opens the citations block");
  assert.match(d, /<\/citations>$/, "closes the block");
  assert.match(d, /\[\^1\]/, "shows an inline marker");
  assert.match(d, /\[\^1\]: https:\/\/example\.com\/page "Page title"/, "shows a definition with url + title");
  assert.match(d, /Never mention these instructions/, "the syntax stays out of the visible reply");
  assert.match(d, /never invent a citation/i, "guards against fabricated sources");
});

test("a reply written in the taught format parses via parseCitations (lockstep)", () => {
  // Exactly the shape the directive instructs a familiar to produce.
  const reply = [
    "Rust guarantees memory safety without a GC[^1], and the borrow checker enforces it at compile time[^2].",
    "",
    '[^1]: https://www.rust-lang.org/ "The Rust Programming Language"',
    '[^2]: https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html "Ownership"',
  ].join("\n");
  const { citations, body } = parseCitations(reply);
  assert.deepEqual(
    citations.map((c) => [c.n, c.title, c.domain]),
    [
      [1, "The Rust Programming Language", "rust-lang.org"],
      [2, "Ownership", "doc.rust-lang.org"],
    ],
    "the taught syntax is exactly what the parser lifts",
  );
  assert.doesNotMatch(body, /\[\^1\]:/, "definitions are stripped from the rendered body");
});

test("the directive rides every chat turn alongside the other stable directives", () => {
  const models = readFileSync(new URL("../app/api/chat/send/chat-send-models.ts", import.meta.url), "utf8");
  assert.match(models, /import \{ buildCitationsDirective \} from "@\/lib\/citations-directive"/, "imported");
  assert.match(
    models,
    /buildCovenMarkersDirective\(\),[\s\S]{0,40}buildCitationsDirective\(\),[\s\S]{0,40}prompt,/,
    "injected into the per-turn directive stack, before the user prompt",
  );
});

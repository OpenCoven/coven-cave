import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PIN_CONTENT_MAX,
  PIN_EXCERPT_MAX,
  buildManualStitchBody,
  buildSewChatPrompt,
  buildSewPrompt,
  capPinContent,
  isPinKind,
  isValidThreadId,
  makeExcerpt,
  makePin,
  normalizePinRefs,
  parseSewOutput,
  pinRefs,
} from "@/lib/stitch";

describe("pin kinds and ids", () => {
  it("accepts only known pin kinds", () => {
    for (const kind of ["url", "paste", "file", "chat", "github", "memory"]) {
      assert.equal(isPinKind(kind), true, kind);
    }
    assert.equal(isPinKind("rss"), false);
    assert.equal(isPinKind(null), false);
    assert.equal(isPinKind(3), false);
  });

  it("validates thread ids as strict slugs", () => {
    assert.equal(isValidThreadId("t123abc"), true);
    assert.equal(isValidThreadId("has spaces"), false);
    assert.equal(isValidThreadId("../escape"), false);
    assert.equal(isValidThreadId(""), false);
    assert.equal(isValidThreadId("a".repeat(65)), false);
  });
});

describe("excerpting and caps", () => {
  it("collapses whitespace and caps the excerpt", () => {
    assert.equal(makeExcerpt("a\n\n b\tc"), "a b c");
    const long = "x".repeat(PIN_EXCERPT_MAX * 2);
    const excerpt = makeExcerpt(long);
    assert.equal(excerpt.length, PIN_EXCERPT_MAX);
    assert.ok(excerpt.endsWith("…"));
  });

  it("caps pin content at PIN_CONTENT_MAX", () => {
    const long = "y".repeat(PIN_CONTENT_MAX + 10);
    assert.equal(capPinContent(long).length, PIN_CONTENT_MAX);
    assert.equal(capPinContent("short"), "short");
  });

  it("makePin derives title, excerpt, and capped content", () => {
    const pin = makePin({ kind: "url", ref: " https://example.com ", title: "", content: "Body text here" });
    assert.equal(pin.kind, "url");
    assert.equal(pin.ref, "https://example.com");
    assert.equal(pin.title, "https://example.com");
    assert.equal(pin.excerpt, "Body text here");
    assert.ok(pin.id.startsWith("p"));
    assert.ok(!Number.isNaN(Date.parse(pin.addedAt)));
  });
});

describe("provenance refs", () => {
  it("compacts pins to kind/ref/title", () => {
    const pin = makePin({ kind: "github", ref: "https://github.com/a/b", title: "Repo b", content: "c" });
    assert.deepEqual(pinRefs([pin]), [{ kind: "github", ref: "https://github.com/a/b", title: "Repo b" }]);
  });

  it("normalizes frontmatter pins tolerantly", () => {
    const refs = normalizePinRefs([
      { kind: "url", ref: "https://x.test", title: "X" },
      { kind: "nope", ref: "https://y.test" },
      { kind: "paste", ref: "  " },
      { kind: "memory", ref: "/m/a.md" },
      "garbage",
      null,
    ]);
    assert.deepEqual(refs, [
      { kind: "url", ref: "https://x.test", title: "X" },
      { kind: "memory", ref: "/m/a.md", title: "/m/a.md" },
    ]);
    assert.deepEqual(normalizePinRefs("not-a-list"), []);
  });
});

describe("sew prompt and output contract", () => {
  const thread = {
    title: "Webhook retry policy",
    pins: [
      makePin({ kind: "url", ref: "https://docs.example/webhooks", title: "Webhook docs", content: "Retries: 3x backoff." }),
      makePin({ kind: "paste", ref: "paste", title: "Slack note", content: "We settled on 5 retries max." }),
    ],
  };

  it("builds a sew prompt containing the contract and every pin", () => {
    const prompt = buildSewPrompt(thread);
    assert.match(prompt, /TITLE: <entry title/);
    assert.match(prompt, /TAGS: <2-6/);
    assert.match(prompt, /Working title \/ intent: Webhook retry policy/);
    assert.match(prompt, /Pin 1 — Web page: Webhook docs/);
    assert.match(prompt, /Source: https:\/\/docs\.example\/webhooks/);
    assert.match(prompt, /Pin 2 — Pasted text: Slack note/);
    assert.match(prompt, /5 retries max/);
  });

  it("builds a chat digest that lists pins without full content", () => {
    const prompt = buildSewChatPrompt(thread);
    assert.match(prompt, /sew a Grimoire stitch/);
    assert.match(prompt, /1\. \[Web page\] Webhook docs — https:\/\/docs\.example\/webhooks/);
    assert.match(prompt, /Retries: 3x backoff\./);
  });

  it("parses well-formed sew output", () => {
    const out = parseSewOutput("TITLE: Webhook retries\nTAGS: webhooks, retries\n---\nUse 5 retries.\n");
    assert.deepEqual(out, { title: "Webhook retries", tags: ["webhooks", "retries"], body: "Use 5 retries." });
  });

  it("tolerates a fenced response and empty tags", () => {
    const out = parseSewOutput("```\nTITLE: T\nTAGS:\n---\nBody\n```");
    assert.deepEqual(out, { title: "T", tags: [], body: "Body" });
  });

  it("never strips code fences INSIDE the body (only a whole-response wrap)", () => {
    // A correct, unfenced response whose body contains a fenced code block
    // must come through byte-identical — a line-anchored lazy unfence used to
    // eat the body's fences (review finding on #2891).
    const body = "Intro\n```js\nconsole.log(1)\n```\nAfter";
    const out = parseSewOutput(`TITLE: Foo\nTAGS: a, b\n---\n${body}`);
    assert.equal(out?.body, body);

    // A fully-fenced response with an internal code block unwraps ONLY the
    // outer pair (greedy match to the final closing fence).
    const fenced = "```\nTITLE: Foo\nTAGS: a\n---\nIntro\n```js\nconsole.log(1)\n```\nAfter\n```";
    const outFenced = parseSewOutput(fenced);
    assert.equal(outFenced?.body, "Intro\n```js\nconsole.log(1)\n```\nAfter");
  });

  it("rejects malformed output instead of guessing", () => {
    assert.equal(parseSewOutput("Sure! Here's your entry: ..."), null);
    assert.equal(parseSewOutput("TITLE: X\nTAGS: a\n---\n"), null);
    assert.equal(parseSewOutput(""), null);
  });
});

describe("manual sew prefill", () => {
  it("concatenates pins under headings with source lines", () => {
    const body = buildManualStitchBody({
      pins: [makePin({ kind: "memory", ref: "/m/notes.md", title: "Notes", content: "Line one." })],
    });
    assert.match(body, /^## Notes/);
    assert.match(body, /> Memory file — \/m\/notes\.md/);
    assert.match(body, /Line one\./);
  });
});

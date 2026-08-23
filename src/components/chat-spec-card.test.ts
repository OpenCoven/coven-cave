// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./chat-spec-card.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/chat-spec-card.css", import.meta.url), "utf8");

// The card itself: the affordance, its labels, and the handoff variant.
assert.match(component, /spec\.kind === "handoff"/);
assert.match(component, /eyebrow: "Familiar handoff"/);
assert.match(component, /fallbackFilename: "familiar-handoff"/);
assert.match(component, /Open \{labels\.noun\}/);
assert.match(component, /focus-ring/);
assert.match(component, /onOpenUrl\?: \(url: string\) => void/);

// The reader itself lives in the shared ChatMarkdownReader (see
// chat-markdown-reader.test.ts), so a spec and a project .md file read
// identically instead of drifting apart.
assert.match(
  component,
  /<ChatMarkdownReader[\s\S]*?markdown=\{spec\.markdown\}[\s\S]*?onOpenUrl=\{onOpenUrl\}/,
  "the card opens the shared chat reader, passing the surface's URL opener",
);
assert.match(
  component,
  /noun=\{labels\.noun\}[\s\S]*?subject=\{labels\.subject\}/,
  "spec/handoff wording travels into the shared reader",
);

assert.match(css, /prefers-reduced-motion:\s*reduce/);
assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
assert.doesNotMatch(css, /rgba?\(/i);

console.log("chat-spec-card: all assertions passed");

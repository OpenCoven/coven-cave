// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./chat-spec-card.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/chat-spec-card.css", import.meta.url), "utf8");

assert.match(component, /createPortal\(reader, document\.body\)/);
assert.match(component, /useFocusTrap\(open, dialogRef/);
assert.match(component, /role="dialog"/);
assert.match(component, /aria-modal="true"/);
assert.match(component, /<MarkdownBlock[\s\S]*?text=\{spec\.markdown\}/);
assert.match(component, /readerOutline\(spec\.markdown\)/);
assert.match(component, /copyText\(spec\.markdown\)/);
assert.match(component, /new Blob\(\[spec\.markdown\]/);
assert.match(component, /spec\.kind === "handoff"/);
assert.match(component, /eyebrow: "Familiar handoff"/);
assert.match(component, /fallbackFilename: "familiar-handoff"/);
assert.match(component, /Open \{labels\.noun\}/);
assert.match(component, /aria-label=\{`Close \$\{labels\.noun\} reader`\}/);
assert.match(component, /MutationObserver/);
assert.match(component, /aria-live="polite"/);
assert.match(component, /focus-ring/);
assert.match(component, /onOpenUrl\?: \(url: string\) => void/);
assert.match(
  component,
  /<MarkdownBlock[\s\S]*?onOpenUrl=\{onOpenUrl\}/,
  "spec links use the chat surface's URL opener",
);
assert.match(
  component,
  /className="chat-spec-reader__document focus-ring-inset"[\s\S]*?role="region"[\s\S]*?aria-label=\{`\$\{spec\.title\} document`\}[\s\S]*?tabIndex=\{0\}/,
  "the scrollable document is a labeled keyboard focus target",
);
assert.match(css, /prefers-reduced-motion:\s*reduce/);
assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
assert.doesNotMatch(css, /rgba?\(/i);

console.log("chat-spec-card: all assertions passed");

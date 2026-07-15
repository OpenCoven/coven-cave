// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./avatar-lightbox.tsx", import.meta.url), "utf8");

assert.match(src, /export function AvatarLightbox/, "Must export AvatarLightbox");

// The primitive reuses the shared Modal for the enlarged view — it must NOT
// hand-roll its own portal / focus-trap. Keeping the lightbox on one Modal is
// the whole point of extracting this primitive.
assert.match(src, /from "\.\/modal"/, "must reuse the shared Modal, not a hand-rolled dialog");
assert.doesNotMatch(src, /createPortal|useFocusTrap/, "focus-trap/portal must stay owned by Modal");

// Click enlarges: a button trigger toggles the enlarged state open.
assert.match(src, /type="button"/, "trigger must be a real button for keyboard + a11y");
assert.match(src, /onClick=\{\(\) => setEnlarged\(true\)\}/, "clicking the trigger opens the lightbox");
assert.match(src, /cave-avatar-lightbox-trigger/, "trigger carries the shared reset class");
assert.match(src, /focus-ring/, "trigger composes the shared focus-ring utility");

// Accessible naming: the trigger announces the subject + noun, and the enlarged
// image carries alt text (never a decorative empty alt in the lightbox).
assert.match(src, /aria-label=\{`Enlarge \$\{label\} \$\{noun\}`\}/, "trigger aria-label names the subject");
assert.match(src, /alt=\{`\$\{label\} \$\{noun\}`\}/, "enlarged img has descriptive alt text");
assert.match(src, /breadcrumb=\{\[label, category\]\}/, "Modal is named via its breadcrumb");

// The operator-avatar decision (click = expand; settings becomes a modal link)
// rides on this optional footer slot — it must be forwarded to the Modal.
assert.match(src, /footerActions=\{footerActions\}/, "footerActions passes through to the Modal footer");

console.log("avatar-lightbox.test.ts: ok");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./modal.tsx", import.meta.url), "utf8");

// The dialog must carry an accessible name. Most call sites pass a breadcrumb and
// no ariaLabel, so the breadcrumb header has to name the dialog via aria-labelledby
// (fall back to aria-label only when there's no breadcrumb). Without this, screen
// readers announce those dialogs with no title.
assert.match(
  src,
  /aria-labelledby=\{breadcrumb \? headingId : undefined\}/,
  "dialog names itself from the breadcrumb header when present",
);
assert.match(
  src,
  /aria-label=\{breadcrumb \? undefined : ariaLabel\}/,
  "dialog falls back to ariaLabel only when there's no breadcrumb",
);
assert.match(
  src,
  /aria-describedby=\{ariaDescribedBy\}/,
  "dialog can expose a useful body description",
);
assert.match(src, /const headingId = useId\(\)/, "modal mints a stable id via useId");
assert.match(
  src,
  /className="ui-modal-header-breadcrumb" id=\{headingId\}/,
  "the breadcrumb header carries the id referenced by aria-labelledby",
);

// Escape dismissal must be gateable (cave-0g9u): callers with an in-flight
// submit pass dismissOnEscape={!busy} so Esc can't close the dialog
// mid-mutation, mirroring the existing dismissOnBackdrop gate. The trap stays
// active either way — only its onEscape callback is withheld.
assert.match(src, /dismissOnEscape\?: boolean/, "Modal exposes a dismissOnEscape prop");
assert.match(src, /dismissOnEscape = true/, "dismissOnEscape defaults to true");
assert.match(
  src,
  /useFocusTrap\(open, dialogRef, \{ onEscape: dismissOnEscape \? onClose : undefined \}\)/,
  "the trap stays active while busy; only the Esc dismissal callback is gated",
);

// Optional escape hatch (cave-fzr4p): Modal itself stays Popover-agnostic, but
// exposes its complete backdrop layer via a callback ref so a caller like
// AvatarLightbox can register it as an "inside" layer of an ancestor Popover.
// Registering only the inner dialog leaves backdrop presses outside that layer,
// so the Popover dismisses before the Modal can close itself.
assert.match(
  src,
  /onLayerElement\?: \(el: HTMLDivElement \| null\) => void;/,
  "Modal accepts an optional onLayerElement callback",
);
assert.match(
  src,
  /const setLayerElement = useCallback\(\s*\(el: HTMLDivElement \| null\) => \{\s*onLayerElement\?\.\(el\);\s*\},\s*\[onLayerElement\],\s*\);/,
  "the complete modal layer uses a memoized callback ref",
);
assert.match(
  src,
  /ref=\{setLayerElement\}[\s\S]{0,120}className="ui-modal-backdrop"/,
  "the stable callback ref exposes the backdrop rather than only the inner dialog",
);
assert.doesNotMatch(
  src,
  /abovePopovers|ui-modal-backdrop--above-popovers/,
  "Modal keeps the shared layer order; its owning Popover is covered instead",
);

console.log("modal.test.ts: ok");

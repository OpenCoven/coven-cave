// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./voice-call-button.tsx", import.meta.url), "utf8");

test("button renders disabled when familiar.voiceProvider is unset", () => {
  assert.match(
    source,
    /disabled=\{[^}]*!familiar\.voiceProvider[^}]*\}/,
    "voice-call-button should disable itself when voiceProvider is unset",
  );
});

test("button surfaces voice_not_configured tooltip when disabled", () => {
  assert.match(
    source,
    /title=\{[^}]*Open Familiar Studio/,
    "voice-call-button should show a 'Open Familiar Studio' hint when disabled",
  );
});

test("button calls onOpen when clicked", () => {
  assert.match(
    source,
    /onClick=\{[^}]*onOpen[^}]*\}/,
    "voice-call-button should wire onClick to the onOpen prop",
  );
});

test("button uses a phone icon", () => {
  assert.match(
    source,
    /ph:phone/i,
    "voice-call-button should use a phone iconify glyph",
  );
});

// ---------------------------------------------------------------------------
// CHAT-D11-02 — ad-hoc chat overlays must adopt the shared focus trap
// (src/lib/use-focus-trap.ts, same infra as ui/modal.tsx) instead of bare
// window-level Escape listeners. Pins: trap adoption, ad-hoc listener removal,
// and the focus-restore path in the shared hook.
// ---------------------------------------------------------------------------

const messageBubbleSource = readFileSync(
  new URL("./message-bubble.tsx", import.meta.url),
  "utf8",
);
const chatViewSource = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const focusTrapSource = readFileSync(
  new URL("../lib/use-focus-trap.ts", import.meta.url),
  "utf8",
);

/** Slice a top-level `function <name>` body out of a source file (to the next
 *  top-level `function` declaration, or EOF). Keeps the no-ad-hoc-listener
 *  assertions scoped to the overlay, not the whole file. */
function sliceFunction(src, name) {
  const start = src.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `expected to find function ${name}`);
  const next = src.indexOf("\nfunction ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

const expandModal = sliceFunction(messageBubbleSource, "MarkdownExpandModal");
const lightbox = sliceFunction(chatViewSource, "AttachmentLightbox");

test("CHAT-D11-02: MarkdownExpandModal uses the shared focus trap", () => {
  assert.match(
    messageBubbleSource,
    /import \{ useFocusTrap \} from "@\/lib\/use-focus-trap"/,
    "message-bubble should import the shared useFocusTrap hook",
  );
  assert.match(
    expandModal,
    /useFocusTrap\(true, dialogRef, \{ onEscape: onClose \}\)/,
    "MarkdownExpandModal should activate useFocusTrap with Escape wired to onClose",
  );
  assert.match(
    expandModal,
    /ref=\{dialogRef\}/,
    "MarkdownExpandModal should attach the trap container ref to the dialog",
  );
  assert.match(
    expandModal,
    /tabIndex=\{-1\}/,
    "MarkdownExpandModal dialog needs tabIndex={-1} for the trap's container-focus fallback",
  );
});

test("CHAT-D11-02: AttachmentLightbox uses the shared focus trap", () => {
  assert.match(
    chatViewSource,
    /import \{ useFocusTrap \} from "@\/lib\/use-focus-trap"/,
    "chat-view should import the shared useFocusTrap hook",
  );
  assert.match(
    lightbox,
    /useFocusTrap\(true, dialogRef, \{ onEscape: onClose \}\)/,
    "AttachmentLightbox should activate useFocusTrap with Escape wired to onClose",
  );
  assert.match(
    lightbox,
    /ref=\{dialogRef\}/,
    "AttachmentLightbox should attach the trap container ref to the dialog",
  );
  assert.match(
    lightbox,
    /tabIndex=\{-1\}/,
    "AttachmentLightbox dialog needs tabIndex={-1} for the trap's container-focus fallback",
  );
});

test("CHAT-D11-02: ad-hoc window keydown listeners are gone from both overlays", () => {
  assert.doesNotMatch(
    expandModal,
    /window\.addEventListener\(\s*["']keydown["']/,
    "MarkdownExpandModal must not register its own window keydown listener — the trap owns Escape",
  );
  assert.doesNotMatch(
    lightbox,
    /window\.addEventListener\(\s*["']keydown["']/,
    "AttachmentLightbox must not register its own window keydown listener — the trap owns Escape",
  );
});

test("CHAT-D11-02: overlays keep dialog semantics", () => {
  for (const [name, body] of [["MarkdownExpandModal", expandModal], ["AttachmentLightbox", lightbox]]) {
    assert.match(body, /role="dialog"/, `${name} should keep role="dialog"`);
    assert.match(body, /aria-modal="true"/, `${name} should keep aria-modal="true"`);
    assert.match(body, /aria-label=\{/, `${name} should keep an aria-label`);
  }
});

test("CHAT-D11-02: overlay backdrops are presentation-only and panels own dialog semantics", () => {
  for (const [name, body] of [["MarkdownExpandModal", expandModal], ["AttachmentLightbox", lightbox]]) {
    assert.match(
      body,
      /<div\s+(?=[^>]*className="fixed inset-0)(?=[^>]*onClick=\{onClose\})(?=[^>]*role="presentation")[^>]*>/,
      `${name} backdrop should be presentation-only`,
    );
    assert.match(
      body,
      /<div\s+[\s\S]{0,80}ref=\{dialogRef\}[\s\S]{0,300}className="relative[\s\S]{0,300}onClick=\{\(e\) => e\.stopPropagation\(\)\}[\s\S]{0,160}role="dialog"[\s\S]{0,80}aria-modal="true"[\s\S]{0,120}aria-label=\{[\s\S]{0,120}tabIndex=\{-1\}/,
      `${name} panel should own the focus trap ref and dialog semantics`,
    );
  }
});

test("CHAT-D11-02: shared trap provides the focus-restore path the overlays rely on", () => {
  assert.match(
    focusTrapSource,
    /returnFocusRef\.current = \(document\.activeElement as HTMLElement\) \?\? null/,
    "useFocusTrap should capture the previously-focused element (the trigger) on activate",
  );
  assert.match(
    focusTrapSource,
    /returnFocusRef\.current\?\.focus\(\)/,
    "useFocusTrap should restore focus to the trigger on deactivate/unmount",
  );
});

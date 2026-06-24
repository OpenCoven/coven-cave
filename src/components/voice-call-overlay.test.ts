// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./voice-call-overlay.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.match(
  component,
  /import\s+\{[^}]*useFocusTrap[^}]*\}\s+from\s+["']@\/lib\/use-focus-trap["']/,
  "VoiceCallOverlay imports the shared focus trap",
);

assert.match(
  component,
  /useFocusTrap\(true,\s*dialogRef,\s*\{\s*onEscape:\s*\(\)\s*=>\s*dispatch\(\{\s*type:\s*"CLOSE_REQUEST"\s*\}\)\s*\}\)/,
  "VoiceCallOverlay traps focus and closes cleanly on Escape",
);

assert.match(
  component,
  /role="dialog"[\s\S]{0,160}aria-modal="true"[\s\S]{0,160}aria-labelledby="voice-call-overlay-title"/,
  "VoiceCallOverlay exposes named modal dialog semantics",
);

assert.match(
  component,
  /id="voice-call-overlay-title"/,
  "VoiceCallOverlay provides a heading id for aria-labelledby",
);

assert.match(
  component,
  /tabIndex=\{-1\}/,
  "VoiceCallOverlay dialog can receive fallback focus",
);

assert.match(
  component,
  /className="voice-call-overlay__retry focus-ring"/,
  "error retry action uses the styled overlay button class",
);

assert.match(
  component,
  /className="voice-call-overlay__control focus-ring"/,
  "mute action uses the styled overlay control class",
);

assert.match(
  styles,
  /\.voice-call-overlay\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*1200;[\s\S]*?place-items:\s*center;/,
  "voice overlay is fixed, centered, and above mobile chrome",
);

assert.match(
  styles,
  /\.voice-call-overlay__dialog\s*\{[\s\S]*?background:\s*var\(--bg-raised\);[\s\S]*?box-shadow:/,
  "voice overlay dialog has a styled raised surface",
);

assert.match(
  styles,
  /\.voice-call-overlay__end\s*\{[\s\S]*?background:\s*var\(--color-danger\);/,
  "end-call button reads as the destructive primary action",
);

// ── Call status + errors are announced to assistive tech ─────────────────────
// Was: a plain <span> whose text cycled through requesting-mic → connecting →
// live → error with no live region, so screen readers heard nothing.
assert.match(
  component,
  /className="voice-call-overlay__state" role="status" aria-live="polite"/,
  "the call-status label is a polite live region so transitions are announced",
);
assert.match(
  component,
  /className="voice-call-overlay__error" role="alert"/,
  "the error block is an alert so failures interrupt the screen reader",
);
assert.match(
  component,
  /aria-describedby=\{state\.state === "error" \? "voice-call-overlay-error" : undefined\}/,
  "the dialog is described by the error message while in the error state",
);
assert.match(
  component,
  /<div id="voice-call-overlay-error">\{errorMessage\(state\.errorCode\)\}<\/div>/,
  "the error headline is a human message, not the raw error code",
);

// ── Raw error codes map to actionable messages ───────────────────────────────
assert.match(component, /function errorMessage\(code: string \| undefined\): string/, "errorMessage maps codes to readable text");
assert.match(component, /case "microphone_denied":[\s\S]*?Microphone access was denied/, "microphone_denied becomes a friendly, actionable message");
assert.doesNotMatch(
  component,
  /<div>\{state\.errorCode\}<\/div>/,
  "the raw error code is no longer rendered as the headline",
);

console.log("voice-call-overlay.test.ts: ok");

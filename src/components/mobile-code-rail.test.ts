// @ts-nocheck
// PR 3 / Task 3: below the mobile breakpoint (isMobile || paneNarrow) the code
// rail is presented as a full-height right-edge slide-over sheet over the
// full-screen chat, opened by an explicit toggle button and dismissible by
// backdrop tap / Escape / onCollapse. Source-text guard — pins the wiring so it
// survives refactors of chat-surface.tsx and workspace-rail.tsx.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const rail = await readFile(new URL("./workspace-rail.tsx", import.meta.url), "utf8");
const css = await readFile(
  new URL("../styles/cave-chat.css", import.meta.url),
  "utf8",
);

// ── Local state, default false ──────────────────────────────────────────────
// The overlay must NOT auto-open from rail.open — an unbidden overlay on mobile
// is intrusive. It starts closed and only the toggle button opens it.
assert.match(
  source,
  /const\s+\[\s*mobileRailOpen\s*,\s*setMobileRailOpen\s*\]\s*=\s*useState\(\s*false\s*\)/,
  "mobileRailOpen state defaults to false",
);

// ── Toggle button gated on (isMobile || paneNarrow) && rail.available ────────
assert.match(
  source,
  /\(isMobile \|\| paneNarrow\) && rail\.available/,
  "toggle button (and sheet) gated on (isMobile || paneNarrow) && rail.available",
);
// The toggle flips mobileRailOpen and carries the right a11y attributes.
assert.match(
  source,
  /aria-haspopup="dialog"/,
  "toggle button advertises aria-haspopup=dialog",
);
assert.match(
  source,
  /aria-expanded=\{mobileRailOpen\}/,
  "toggle button reflects sheet open state via aria-expanded",
);
assert.match(
  source,
  /aria-label=\{mobileRailOpen \? "Hide code rail" : "Show code rail"\}/,
  "toggle button has a state-reflecting accessible label",
);
assert.match(
  source,
  /setMobileRailOpen\(\s*(?:\(\s*v\s*\)\s*=>\s*!v|true)\s*\)/,
  "toggle button opens the sheet",
);
// The change-count badge rides the toggle when there are pending edits.
assert.match(
  source,
  /changeCount > 0[\s\S]{0,120}mobile-code-rail-toggle__badge/,
  "toggle button shows the change-count badge when changeCount > 0",
);

// ── The sheet: cloned from chat-right-sheet ─────────────────────────────────
assert.match(
  source,
  /className="[^"]*mobile-code-rail-sheet[^"]*fixed inset-0[\s\S]*?justify-end"/,
  "sheet is a fixed inset-0 justify-end scrim (chat-right-sheet clone)",
);
assert.match(
  source,
  /bg-\[var\(--backdrop-scrim\)\]/,
  "sheet backdrop uses --backdrop-scrim",
);
assert.match(
  source,
  /w-\[min\(92vw,420px\)\]/,
  "sheet panel is w-[min(92vw,420px)]",
);
assert.match(
  source,
  /padding-bottom:var\(--sai-bottom\)/,
  "sheet panel honors the bottom safe-area inset",
);
assert.match(
  source,
  /role="dialog"/,
  "sheet is a role=dialog",
);
assert.match(
  source,
  /aria-modal="true"/,
  "sheet is aria-modal",
);

// ── WorkspaceRail hosted in the sheet with onCollapse → close ───────────────
// The sheet mounts WorkspaceRail with the same feed as desktop, but onCollapse
// closes the overlay (mobile "collapse" == dismiss) and the pin control is
// hidden (meaningless in a sheet).
assert.match(
  source,
  /<WorkspaceRail[\s\S]*?hidePin[\s\S]*?onCollapse=\{\(\)\s*=>\s*setMobileRailOpen\(false\)\}[\s\S]*?\/>/,
  "sheet WorkspaceRail hides the pin and maps onCollapse to closing the sheet",
);

// ── Dismiss surfaces: backdrop + Escape ─────────────────────────────────────
assert.match(
  source,
  /aria-label="Close code rail"[\s\S]*?onClick=\{\(\)\s*=>\s*setMobileRailOpen\(false\)\}/,
  "backdrop button closes the sheet",
);
assert.match(
  source,
  /useFocusTrap\(\s*mobileRailOpen\s*,\s*mobileRailSheetRef\s*,\s*\{\s*onEscape:\s*\(\)\s*=>\s*setMobileRailOpen\(false\)/,
  "sheet traps focus while open and Escape closes it",
);

// ── Auto-close guards ───────────────────────────────────────────────────────
// Close when nothing to show (rail.available false) and when leaving mobile
// (desktop layout owns the third column) so the sheet can't get stuck open.
assert.match(
  source,
  /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*!rail\.available[\s\S]*?setMobileRailOpen\(false\)/,
  "sheet auto-closes when rail.available goes false or leaving mobile",
);
assert.match(
  source,
  /!isMobile && !paneNarrow[\s\S]*?setMobileRailOpen\(false\)/,
  "sheet auto-closes when leaving the mobile / narrow layout",
);

// ── WorkspaceRail gained an optional hidePin prop (desktop unchanged) ────────
assert.match(
  rail,
  /hidePin\??:\s*boolean/,
  "WorkspaceRail accepts an optional hidePin prop",
);
assert.match(
  rail,
  /\{\s*!hidePin\s*(?:&&|\?)[\s\S]*?Pin code rail open/,
  "WorkspaceRail hides the pin button when hidePin is set",
);

// ── Motion + reduced-motion CSS ─────────────────────────────────────────────
assert.match(
  css,
  /@keyframes\s+mobile-code-rail-sheet-in\b/,
  "defines the sheet slide-in keyframes",
);
assert.match(
  css,
  /\.mobile-code-rail-sheet__panel\s*\{[^}]*animation:\s*mobile-code-rail-sheet-in/s,
  "sheet panel runs the slide-in animation",
);
assert.match(
  css,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.mobile-code-rail-sheet__panel[^}]*\{[^}]*animation:\s*none/s,
  "reduced-motion disables the sheet slide-in",
);

console.log("mobile-code-rail.test.ts OK");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quick-chat-overlay.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");

assert.match(
  source,
  /useQuickChat\(\{ preferredFamiliarId: activeFamiliarId \?\? null \}\)/,
  "overlay shares the quick-chat state/send logic via useQuickChat, preferring the workspace's active familiar",
);
assert.match(
  source,
  /role="dialog"/,
  "overlay panel is a dialog",
);
assert.match(
  source,
  /aria-modal="true"/,
  "overlay dialog is modal",
);
assert.match(
  source,
  /aria-label="Quick chat"/,
  "overlay dialog is accessibly labeled",
);
assert.match(
  source,
  /useFocusTrap\(open, dialogRef, \{ onEscape: onClose/,
  "overlay traps focus while open — Tab cycles within it, Escape closes, focus returns to the trigger",
);
assert.match(
  source,
  /<QuickChatThread[\s\S]*messages=\{messages\}/,
  "overlay renders the shared multi-turn conversation thread",
);
assert.match(
  source,
  /onOpenFullSession\?\.\(sessionId, selectedFamiliarId\)/,
  "overlay opens the saved session (the whole thread's context) in the full app",
);
const controls = readFileSync(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");
assert.match(
  controls,
  /aria-live="polite"/,
  "the shared thread announces streamed replies via a polite live region",
);
assert.match(
  controls,
  /MarkdownBlock/,
  "familiar replies render markdown through the shared MarkdownBlock",
);
assert.match(
  source,
  /\(event\.metaKey \|\| event\.ctrlKey\) && event\.key === "Enter"/,
  "overlay textarea sends on Cmd/Ctrl+Enter",
);
assert.match(
  source,
  /onClick=\{onClose\}/,
  "overlay backdrop / close button calls onClose",
);

// Workspace wires the overlay to its open state and the full-session opener.
assert.match(
  workspace,
  /<QuickChatOverlay[\s\S]*onOpenFullSession=\{\(sid, fid\) =>/,
  "workspace renders QuickChatOverlay and routes Open-in-full-chat to openFamiliarSession",
);

// ── Dropdown-from-the-menubar: anchored under its trigger, on left click ──────
assert.match(
  topBar,
  /data-quick-chat-trigger[\s\S]{0,120}onClick=\{onOpenQuickChat\}/,
  "the menubar trigger is tagged for anchoring and opens the dropdown on (left) click",
);
assert.match(
  source,
  /querySelectorAll\("\[data-quick-chat-trigger\]"\)/,
  "the overlay finds its menubar trigger to anchor beneath it",
);
assert.match(
  source,
  /\.find\(\(el\) => el\.getBoundingClientRect\(\)\.width > 0\)/,
  "the overlay anchors to the visible trigger instance (top bar is rendered per-breakpoint)",
);
assert.match(
  source,
  /style=\{anchor \? \{ top: anchor\.top, right: anchor\.right \} : undefined\}/,
  "the dropdown drops from just below the trigger (falls back to the CSS corner)",
);
assert.match(
  source,
  /className="quick-chat-overlay__caret"/,
  "a caret connects the dropdown to the menubar trigger",
);
assert.match(
  source,
  /window\.addEventListener\("resize", measure\)/,
  "the anchor position is kept in sync on resize",
);

// ── ⌘J toggles quick chat from anywhere, and it's listed in the catalog ───────
assert.match(
  workspace,
  /if \(k === "j"\) \{\s*e\.preventDefault\(\);\s*setQuickChatOpen\(\(open\) => !open\);/,
  "⌘/Ctrl+J toggles the quick-chat dropdown globally",
);
assert.match(
  shortcuts,
  /\{ keys: "⌘J", description: "Toggle quick chat" \}/,
  "the shortcut catalog documents ⌘J (shortcuts sheet + /help)",
);
// Tooltips advertise the shortcut without polluting the accessible name.
assert.match(topBar, /aria-label="Quick chat"\s*\n\s*title="Quick chat \(⌘J\)"/, "mobile trigger tooltip shows the shortcut, aria-label stays clean");

// ── Familiar default: workspace-active > last-used > first ───────────────────
const hook = readFileSync(new URL("../lib/use-quick-chat.ts", import.meta.url), "utf8");
assert.match(
  hook,
  /\(preferred && next\.some\(\(familiar\) => familiar\.id === preferred\) \? preferred : null\) \?\?\s*\(stored && next\.some\(\(familiar\) => familiar\.id === stored\) \? stored : null\) \?\?\s*next\[0\]\?\.id/,
  "the initial default prefers the workspace-active familiar, then last-used, then first",
);
assert.match(
  hook,
  /if \(!preferredFamiliarId \|\| userPickedRef\.current\) return;/,
  "the popover follows the active familiar only until the user manually picks one",
);
assert.match(
  hook,
  /setSelectedFamiliarId: pickFamiliar/,
  "manual picks flow through pickFamiliar so they override the active-familiar default",
);
assert.match(
  workspace,
  /<QuickChatOverlay[\s\S]*?activeFamiliarId=\{activeId\}/,
  "workspace passes its active familiar to the quick-chat popover",
);

// ── Multi-turn conversation: the dropdown holds a real back-and-forth ────────
assert.match(
  hook,
  /messages: QuickChatMessage\[\]/,
  "the hook exposes the conversation as a list of turns, not a single answer",
);
assert.match(
  hook,
  /sessionId: resume \? sessionIdRef\.current \?\? undefined : undefined/,
  "follow-up turns resume the same daemon session so context carries over",
);
assert.match(
  hook,
  /setDraft\(""\);/,
  "the composer draft is cleared the moment a turn is sent (no stale resend)",
);
assert.match(
  hook,
  /if \(selectedIdRef\.current !== id\) newThread\(\);/,
  "switching to a different familiar starts a fresh thread",
);
for (const fn of ["newThread", "regenerate", "cancel"]) {
  assert.ok(hook.includes(`${fn},`), `the hook exposes ${fn}() to its consumers`);
}

console.log("quick-chat-overlay.test.ts OK");

// ── Loading state: cold roster reads as "loading", not "no familiar" ──────────
const tray = readFileSync(new URL("./tray-quick-chat.tsx", import.meta.url), "utf8");
for (const [name, src] of [["overlay", source], ["tray", tray]]) {
  assert.match(
    src,
    /loading \? "Loading familiars…" : selectedFamiliar \? `@\$\{selectedFamiliar\.id\}` : "No familiar selected"/,
    `${name} header shows a loading state while the roster loads`,
  );
}
assert.match(
  source,
  /loading && familiars\.length === 0\s*\?\s*\[\{ value: "", label: "Loading…", disabled: true \}\]/,
  "the familiar select shows a disabled Loading placeholder through StandardSelect options while empty",
);
assert.match(
  tray,
  /loading && familiars\.length === 0\s*\?\s*\[\{ value: "", label: "Loading…", disabled: true \}\]/,
  "the tray familiar select shows a disabled Loading placeholder through StandardSelect options while empty",
);
for (const [name, src] of [["overlay", source], ["tray", tray]]) {
  assert.ok(src.includes('import { Button } from "@/components/ui/button"'), `${name} action buttons use the shared Button primitive`);
  assert.ok(src.includes('import { IconButton } from "@/components/ui/icon-button"'), `${name} icon buttons use the shared IconButton primitive`);
  assert.doesNotMatch(
    src,
    /<button\b/,
    `${name} does not hand-roll button controls`,
  );
  assert.match(
    src,
    /<StandardSelect[\s\S]{0,320}rounded-\[var\(--radius-control\)\]/,
    `${name} selector controls use the shared control radius token`,
  );
  assert.doesNotMatch(
    src,
    /<StandardSelect[\s\S]{0,320}rounded-md/,
    `${name} selector controls do not hard-code Tailwind's md radius`,
  );
  assert.doesNotMatch(
    src,
    /rounded-md/,
    `${name} avoids hard-coded md radius in the quick-chat surface`,
  );
}

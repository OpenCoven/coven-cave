// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quick-chat-overlay.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");

assert.match(
  source,
  /useQuickChat\(\)/,
  "overlay shares the quick-chat state/send logic via the useQuickChat hook",
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
  /event\.key === "Escape"[\s\S]*onClose\(\)/,
  "Escape closes the overlay via a window keydown listener",
);
assert.match(
  source,
  /window\.addEventListener\("keydown"/,
  "overlay listens for keydown while open",
);
assert.match(
  source,
  /onOpenFullSession\?\.\(sessionId, selectedFamiliarId\)/,
  "overlay opens the saved session in the full app",
);
assert.match(
  source,
  /aria-live="polite"/,
  "overlay answer pane announces streamed text",
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

console.log("quick-chat-overlay.test.ts OK");

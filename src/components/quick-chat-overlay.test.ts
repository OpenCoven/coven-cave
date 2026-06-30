// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quick-chat-overlay.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

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

console.log("quick-chat-overlay.test.ts OK");

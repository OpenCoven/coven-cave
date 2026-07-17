// @ts-nocheck
// Pins for the recommended-next-path composer ghost fill (cave-h62k): the
// empty composer mirrors the last settled turn's top suggestion as its
// placeholder, and ⇥ / ← accept it as an editable draft — fill, never send.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// The recommendation derives from the ACTIVE branch path's last settled
// assistant turn — same suggestion the pills flag as "Recommended".
assert.match(
  source,
  /const recommendedNextPath = useMemo\(\(\) => \{[\s\S]*?extractNextPaths\(last\.text\)\.suggestions\[0\] \?\? null;[\s\S]*?\}, \[activePath\]\);/,
  "recommendedNextPath memo reads the active path's last settled assistant turn",
);
assert.match(
  source,
  /\.find\(\(t\) => t\.role === "assistant" && !t\.pending && !t\.error\)/,
  "pending and errored turns never feed the recommendation",
);

// Key handling: empty-draft-only, not while busy, Shift+Tab untouched, and
// ordered AFTER the menu/token handlers so they keep owning Tab while open.
const keyBranch = source.match(
  /\(\(e\.key === "Tab" && !e\.shiftKey\) \|\| e\.key === "ArrowLeft"\) &&\n\s*input === "" &&\n\s*!busy &&\n\s*recommendedNextPath/,
);
assert.ok(keyBranch, "⇥/← fill is gated on empty draft, not-busy, and a live recommendation");
const menuKeyIdx = source.indexOf("if (handleMenuKey(e)) return;");
const fillIdx = source.indexOf('e.key === "ArrowLeft"');
assert.ok(menuKeyIdx !== -1 && fillIdx > menuKeyIdx, "menus keep owning Tab — fill branch comes after handleMenuKey");
assert.match(
  source,
  /setInput\(recommendedNextPath\);\n\s*return;/,
  "accepting fills the draft (never sends)",
);

// Placeholder: the recommendation replaces the idle hint; streaming keeps
// its own placeholder.
assert.match(
  source,
  /: recommendedNextPath\n\s*\? `\$\{recommendedNextPath\}  ⇥ to fill`/,
  "empty composer shows the recommendation as its placeholder with the ⇥ hint",
);

console.log("chat-composer-rec-autofill: all pins hold");

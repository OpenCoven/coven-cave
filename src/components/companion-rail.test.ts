// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./companion-rail.tsx", import.meta.url), "utf8");

assert.match(source, /export function CompanionRail/, "Component must be named CompanionRail");
assert.match(source, /companion-rail__header/, "Header element with BEM class");
assert.match(source, /companion-rail__tabs/, "Tab strip element with BEM class");
assert.match(
  source,
  /type CompanionTab = "chat" \| "memory" \| "browser" \| "salem"/,
  "Companion tab union must include Browser and Salem (Inspector folded into Memory)",
);
assert.match(source, /Chat/, "Chat label rendered");
assert.doesNotMatch(source, /title="Inspector"/, "standalone Inspector tab removed — folded into the Memory (brain) tab");
assert.match(source, /Memory/, "Memory label rendered");
assert.match(source, /Browser/, "Browser label rendered");
assert.match(source, /Salem/, "Salem label rendered");
assert.match(source, /browserSlot/, "Rail should support a browser pane slot");
assert.match(source, /activeTab/, "Rail should support externally selected tabs");
assert.match(source, /No familiar yet/, "Empty state copy when no familiar");
assert.match(
  source,
  /hideChatTab/,
  "Rail should support hiding the Chat tab when the current main surface is already Chats",
);
assert.match(
  source,
  /hideChatTab \? null : \(/,
  "Rail should omit the Chat tab button when hideChatTab is set",
);

assert.match(
  source,
  /hideChatTab && requestedTab === "chat"[\s\S]*\? browserSlot \? "browser" : fallbackTab/,
  "When the main chat surface hides the duplicate Chat tab, the companion rail should fall back to Browser before Salem",
);

// In-panel collapse trigger — mirrors the left sessions-rail Hide button so the
// right panel can be hidden from its own header (not only via ⌘⇧B).
assert.match(source, /companion-rail__collapse/, "Header includes an in-panel collapse button (BEM class)");
assert.match(source, /aria-label="Hide companion panel"/, "Collapse button is labelled for assistive tech");
assert.match(
  source,
  /ph:sidebar-simple-fill/,
  "Collapse button uses the same sidebar-simple glyph as the left rail's Hide button",
);
assert.match(
  source,
  /new CustomEvent\("cave:familiar-panel-toggle"\)/,
  "Collapse button dispatches cave:familiar-panel-toggle so the Shell reuses its ⌘⇧B collapse path",
);

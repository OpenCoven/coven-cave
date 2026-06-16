// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./companion-rail.tsx", import.meta.url), "utf8");

assert.match(source, /export function CompanionRail/, "Component must be named CompanionRail");
assert.doesNotMatch(source, /companion-rail__header/, "familiar header removed — tab strip is the panel's top row");
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

// The in-panel collapse trigger was removed — hiding the right panel is now
// owned by the shell's floating top-right toggle (and ⌘⇧B), so the rail no
// longer carries its own Hide button.
assert.doesNotMatch(source, /companion-rail__collapse/, "in-panel collapse button is removed");
assert.doesNotMatch(
  source,
  /new CustomEvent\("cave:familiar-panel-toggle"\)/,
  "rail no longer dispatches the cave:familiar-panel-toggle collapse event",
);

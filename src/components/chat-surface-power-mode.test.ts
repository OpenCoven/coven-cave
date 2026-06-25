// @ts-nocheck
// Power mode: the standalone chat transforms its side area into an inline
// chat↔code split (the comux coding surface beside the conversation), now
// selected from a three-way segmented mode switch (Convo / Projects / Code)
// that supersedes the old Sessions/Projects scope tabs + binary Power toggle.
// Memory is removed from the chat surface entirely — it's not part of a
// conversation, so it lives in the Familiars surface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Power-mode state ────────────────────────────────────────────────────────
assert.match(surface, /import \{ ComuxView \} from "@\/components\/comux-view"/, "chat-surface embeds the comux coding surface");
assert.match(surface, /POWER_MODE_KEY = "cave:chat-power-mode:v1"/, "power-mode preference has a stable storage key");
assert.match(surface, /const \[powerMode, setPowerMode\] = useState\(false\)/, "power mode is off by default");
assert.match(
  surface,
  /window\.localStorage\.setItem\(POWER_MODE_KEY, next \? "1" : "0"\)/,
  "entering/leaving code mode persists across reloads",
);

// ── Three-way mode switch (Convo / Projects / Code) ─────────────────────────
assert.match(
  surface,
  /type ChatMode = "convo" \| "projects" \| "code"/,
  "the standalone chat has a three-way mode model",
);
assert.match(
  surface,
  /const chatMode: ChatMode = scope === "projects" \? "projects" : powerMode \? "code" : "convo"/,
  "the switch's selection derives from scope + power-mode state",
);
assert.match(
  surface,
  /function selectChatMode\(next: ChatMode\)/,
  "selecting a mode locks the surface into Convo, Projects, or Code",
);
assert.match(
  surface,
  /<Tabs<ChatMode>\s+variant="segment"/,
  "the mode switch renders as a segmented (lock-in) selector",
);
assert.match(surface, /value=\{chatMode\}/, "the switch reflects the active mode");
assert.match(surface, /onChange=\{selectChatMode\}/, "the switch drives mode selection");
// The legacy binary Power pill is gone — its layout is now one of three locks.
assert.doesNotMatch(surface, /chat-power-toggle/, "the binary Power toggle is replaced by the mode switch");
assert.doesNotMatch(css, /\.chat-power-toggle/, "the dead Power-toggle styling is removed");

// Power mode is standalone-chat only — the Code workspace already is a split.
assert.match(
  surface,
  /const showPowerPanel = powerMode && !isCodeSurface && !isMobile/,
  "power mode only mounts the code panel on the standalone desktop chat",
);
assert.match(
  surface,
  /const showRightSidebar = !showPowerPanel && rightPanel !== null && !isMobile/,
  "the inspector sidebar and the power panel are mutually exclusive",
);

// ── The inline code panel ───────────────────────────────────────────────────
assert.match(surface, /id="code-power"/, "power mode renders a dedicated code panel");
assert.match(
  surface,
  /<ComuxView[\s\S]*?storageNamespace=":chat-power"/,
  "the power-mode comux instance keeps its own isolated terminal/layout namespace",
);
assert.match(surface, /POWER_GROUP_ID = "cave.chat.power.widths.v1"/, "the power split width persists separately from the inspector layout");

// ── Memory is not part of chat ──────────────────────────────────────────────
assert.match(inspector, /hideMemory\?: boolean/, "InspectorPane accepts a hideMemory flag");
assert.match(
  inspector,
  /useState<Tab>\(hideMemory \? "familiar" : "memory"\)/,
  "InspectorPane defaults off the Memory tab when memory is hidden",
);
assert.match(
  inspector,
  /tab === "memory" && !hideMemory \? <MemoryTab/,
  "the Memory tab body never renders when memory is hidden",
);
// chat-surface passes hideMemory to every inspector it mounts.
assert.match(surface, /onInboxItemChanged=\{onInboxItemChanged\}\s*\n\s*hideMemory/, "chat-surface hides memory in its inspector");

console.log("chat-surface-power-mode.test.ts: ok");

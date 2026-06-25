// @ts-nocheck
// Power mode: the standalone chat transforms its side area into an inline
// chat↔code split (the comux coding surface beside the conversation), toggled
// from the scope-tab row. Memory is removed from the chat surface entirely —
// it's not part of a conversation, so it lives in the Familiars surface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Power-mode toggle + state ───────────────────────────────────────────────
assert.match(surface, /import \{ ComuxView \} from "@\/components\/comux-view"/, "chat-surface embeds the comux coding surface");
assert.match(surface, /POWER_MODE_KEY = "cave:chat-power-mode:v1"/, "power-mode preference has a stable storage key");
assert.match(surface, /const \[powerMode, setPowerMode\] = useState\(false\)/, "power mode is off by default");
assert.match(
  surface,
  /window\.localStorage\.setItem\(POWER_MODE_KEY, next \? "1" : "0"\)/,
  "toggling power mode persists across reloads",
);
assert.match(
  surface,
  /className=\{`chat-power-toggle\$\{powerMode \? " chat-power-toggle--on" : ""\}`\}/,
  "the toggle reflects its on/off state via a modifier class",
);
assert.match(surface, /aria-pressed=\{powerMode\}/, "the toggle exposes pressed state to assistive tech");

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

// ── Toggle styling matches the bar ──────────────────────────────────────────
assert.match(css, /\.chat-power-toggle \{[\s\S]*?border-radius: 999px;/, "the power toggle is a pill chip");
assert.match(css, /\.chat-power-toggle--on \{[\s\S]*?--power-accent: var\(--accent\);/, "the active toggle lights up in the theme accent");

console.log("chat-surface-power-mode.test.ts: ok");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./tray-quick-chat.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/quick-chat/page.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");
// Quick-chat state + send logic lives in the shared useQuickChat hook — one
// instance per tab, so every quick chat holds its own thread.
const hook = readFileSync(new URL("../lib/use-quick-chat.ts", import.meta.url), "utf8");
const glassCss = readFileSync(new URL("../styles/quick-chat-glass.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const tauriConf = readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const cargo = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");

assert.match(
  page,
  /import \{ TrayQuickChat \} from "@\/components\/tray-quick-chat"/,
  "quick-chat route renders the tray quick chat component",
);
assert.match(
  component,
  /useQuickChat\(\{ preferredFamiliarId: initialFamiliarId \}\)/,
  "each tab pane runs its own useQuickChat, opening on the familiar it inherited",
);
assert.match(hook, /fetch\("\/api\/familiars"/, "quick chat loads the familiar roster");
// Suspense hide / StrictMode re-runs effects with refs preserved: the roster
// effect's cleanup must abort AND un-latch (unless a load completed), or a
// tab pane that suspends on a cold chunk sticks on "Loading…" forever.
assert.match(
  hook,
  /controller\.abort\(\);\s*\n\s*if \(!rosterLoadedRef\.current\) rosterStartedRef\.current = false;/,
  "the roster load un-latches on cleanup so an effect re-run refetches",
);
assert.match(
  hook,
  /resolveQuickChatTarget\(draft, familiars, selectedFamiliarId\)/,
  "quick chat resolves @familiar mentions before sending",
);
assert.match(
  hook,
  /streamFamiliarText\(\{[\s\S]*familiarId: target\.familiarId,[\s\S]*prompt: target\.prompt/,
  "quick chat sends through the sanctioned familiar chat bridge",
);

// ── Multiple quick chats ─────────────────────────────────────────────────────
// The add button (and ⌘/Ctrl+N) opens a new chat that inherits the ACTIVE
// tab's familiar — a new chat starts on who you're already talking to.
assert.match(
  component,
  /const inherited = reportsRef\.current\[activeIdRef\.current\]\?\.familiar\?\.id \?\? null/,
  "a new tab inherits the active tab's selected familiar",
);
assert.match(component, /aria-label="New chat"/, "the header exposes an add-chat button");
assert.match(
  component,
  /if \(key === "n"\) \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*addTab\(\)/,
  "⌘/Ctrl+N opens a new quick chat",
);
assert.match(
  component,
  /else if \(key === "w"\) \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*closeTab\(activeIdRef\.current\)/,
  "⌘/Ctrl+W closes the active quick chat",
);

// Tabs are real tabs to assistive tech, and background panes stay mounted so
// an in-flight reply keeps streaming behind the active tab.
assert.match(component, /role="tablist" aria-label="Quick chats"/, "the tab strip is a labelled tablist");
assert.match(component, /role="tab"/, "each chat pill is a tab");
assert.match(component, /role="tabpanel"/, "each chat body is a tabpanel");
assert.match(component, /hidden=\{!active\}/, "background tabs hide without unmounting");
assert.match(
  glassCss,
  /\.tray-quick-chat__pane\[hidden\] \{\s*\n\s*display: none;/,
  "the pane's display:flex must not defeat the hidden attribute",
);

// ── Closing the quick chat ───────────────────────────────────────────────────
assert.match(component, /aria-label="Close quick chat"/, "the header exposes a window close button");
assert.match(
  component,
  /getCurrentWindow\(\)\.hide\(\)/,
  "closing hides the tray window through the Tauri window API",
);
assert.match(
  component,
  /if \(next\.length === 0\) \{[\s\S]{0,400}void hideTrayWindow\(\)/,
  "closing the last chat closes the quick chat itself (with a fresh tab waiting behind it)",
);

// ── Glassmorphism ────────────────────────────────────────────────────────────
// The Rust shell only sends ?glass=1 when it actually made the window
// transparent with vibrancy behind it (macOS); the page mirrors it on <html>.
assert.match(
  component,
  /get\("glass"\) === "1"/,
  "the page reads the glass handshake from the window URL",
);
assert.match(
  glassCss,
  /html\[data-glass\],\s*\nhtml\[data-glass\] body \{\s*\n\s*background: transparent !important;/,
  "glass mode clears the opaque page background",
);
assert.match(glassCss, /backdrop-filter: blur/, "glass surfaces blur the content beneath them");
assert.match(
  glassCss,
  /@media \(prefers-reduced-transparency: reduce\)/,
  "reduced-transparency users get solid surfaces back",
);
assert.match(
  shell,
  /let builder = builder\.transparent\(true\);/,
  "the quick-chat window opens transparent on macOS",
);
assert.match(
  shell,
  /apply_vibrancy\(&window, NSVisualEffectMaterial::HudWindow, None, Some\(14\.0\)\)/,
  "macOS puts NSVisualEffectView vibrancy behind the transparent window, rounded to match the CSS frame",
);
assert.match(
  shell,
  /append_pair\("glass", "1"\)/,
  "the shell tells the page it is running over vibrancy",
);
assert.match(
  tauriConf,
  /"macOSPrivateApi": true/,
  "transparent webviews on macOS require the private API flag",
);
assert.match(cargo, /window-vibrancy = "0\.6"/, "the vibrancy crate is pinned");
assert.match(
  cargo,
  /\[target\.'cfg\(target_os = "macos"\)'\.dependencies\]\s*\nwindow-vibrancy/,
  "window-vibrancy stays scoped to the macOS target",
);

// ── Shared pieces (one source of truth with the overlay-era components) ─────
assert.match(component, /<QuickChatControlsRow/, "tray renders the shared controls row");
assert.match(component, /<QuickChatComposer/, "tray renders the shared composer");
assert.match(
  controls,
  /COMMAND_THINKING_OPTIONS/,
  "quick chat uses the shared thinking effort options",
);
assert.match(
  controls,
  /COMMAND_RESPONSE_SPEED_OPTIONS/,
  "quick chat uses the shared response speed options",
);
assert.match(
  hook,
  /streamFamiliarText\(\{[\s\S]*reasoningEffort: thinkingEffort,[\s\S]*responseSpeed,[\s\S]*\}\)/,
  "quick chat forwards compact command controls to the familiar stream helper",
);
assert.match(
  controls,
  /\(event\.metaKey \|\| event\.ctrlKey\) && event\.key === "Enter"/,
  "the shared composer sends the draft on Cmd/Ctrl+Enter",
);
assert.match(component, /useSuggestionPicker\(setDraft\)/, "tray suggestion picks land the caret in the composer");
assert.match(component, /autoFocus=\{active\}/, "the active tab focuses its composer (no focus trap to fight)");
assert.match(
  component,
  /requestAnimationFrame\(\(\) => composerRef\.current\?\.focus\(\)\)/,
  "switching tabs lands the caret in the newly active composer",
);
assert.match(
  component,
  /emit\("quick-chat:open-session"/,
  "quick chat emits an event that opens the saved session in the full app",
);
assert.match(
  workspace,
  /listen\("quick-chat:open-session"/,
  "the main workspace listens for quick chat open-session events",
);

console.log("tray-quick-chat.test.ts OK");

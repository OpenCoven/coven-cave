// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./tray-quick-chat.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/quick-chat/page.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");
// Quick-chat state + send logic now lives in the shared useQuickChat hook,
// consumed by both the Tauri window (this component) and the in-app overlay.
const hook = readFileSync(new URL("../lib/use-quick-chat.ts", import.meta.url), "utf8");

assert.match(
  page,
  /import \{ TrayQuickChat \} from "@\/components\/tray-quick-chat"/,
  "quick-chat route renders the tray quick chat component",
);
assert.match(component, /useQuickChat\(\)/, "tray quick chat consumes the shared useQuickChat hook");
assert.match(hook, /fetch\("\/api\/familiars"/, "quick chat loads the familiar roster");
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
// The tray renders its controls and composer through the shared pieces — the
// command-control options live once, in quick-chat-controls.
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
// The tray suggestion chips focus the composer after filling it — the overlay
// always did; the tray drifting apart was a bug.
assert.match(component, /useSuggestionPicker\(setDraft\)/, "tray suggestion picks land the caret in the composer");
assert.match(component, /autoFocus/, "the tray window focuses its composer on open (no focus trap to fight)");
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

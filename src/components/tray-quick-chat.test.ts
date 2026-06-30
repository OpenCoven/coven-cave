// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./tray-quick-chat.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/quick-chat/page.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  page,
  /import \{ TrayQuickChat \} from "@\/components\/tray-quick-chat"/,
  "quick-chat route renders the tray quick chat component",
);
assert.match(component, /fetch\("\/api\/familiars"\)/, "quick chat loads the familiar roster");
assert.match(
  component,
  /resolveQuickChatTarget\(draft, familiars, selectedFamiliarId\)/,
  "quick chat resolves @familiar mentions before sending",
);
assert.match(
  component,
  /streamFamiliarText\(\{[\s\S]*familiarId: target\.familiarId,[\s\S]*prompt: target\.prompt/,
  "quick chat sends through the sanctioned familiar chat bridge",
);
assert.match(
  component,
  /COMMAND_THINKING_OPTIONS/,
  "quick chat uses the shared thinking effort options",
);
assert.match(
  component,
  /COMMAND_RESPONSE_SPEED_OPTIONS/,
  "quick chat uses the shared response speed options",
);
assert.match(
  component,
  /streamFamiliarText\(\{[\s\S]*reasoningEffort: thinkingEffort,[\s\S]*responseSpeed,[\s\S]*\}\)/,
  "quick chat forwards compact command controls to the familiar stream helper",
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

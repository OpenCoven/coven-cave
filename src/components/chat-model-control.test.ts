// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-model-control.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.match(source, /export function ChatModelControl/);
assert.match(source, /applicationState/);
assert.match(source, /Familiar default|Session override|Next message|Global default/);
assert.match(source, /Saved in Cave|Runtime confirmed|not confirmed/);
assert.match(source, /aria-label="Chat model"/);
assert.match(chatView, /\/api\/chat\/model-state/);
assert.match(chatView, /<ChatModelControl/);
assert.match(css, /\.cave-chat-model-control/);
assert.match(css, /\.cave-chat-model-popover/);

// ── Model parity: the control is an interactive picker, not read-only ──────
assert.match(source, /catalogForRuntime/, "Picker options come from the runtime catalog");
assert.match(source, /onSelectModel/, "Control exposes a selection callback");
assert.match(source, /menuitemradio/, "Curated options render as selectable radio items");
assert.match(source, /allowCustom/, "A custom model field appears when the runtime allows it");
assert.match(css, /\.cave-chat-model-popover__option/, "Option rows have styling");
assert.match(css, /\.cave-chat-model-popover__custom-input/, "Custom model input has styling");

// chat-view wires selection through the existing model-state PATCH channel.
assert.match(chatView, /onSelectModel=\{handleSelectModel\}/, "Chat view passes a select handler");
assert.match(chatView, /method:\s*"PATCH"/, "Selection persists via PATCH");
assert.match(
  chatView,
  /scope:\s*sessionId\s*\?\s*"session"\s*:\s*"familiar-default"/,
  "Selection writes session scope when a chat exists, else familiar-default",
);

console.log("chat-model-control.test.ts: ok");

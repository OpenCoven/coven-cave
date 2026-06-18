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
assert.match(source, /Model for \{state\.harness\} runtime/, "Picker copy should call the backend a runtime");
assert.match(source, /<span>Runtime<\/span>/, "Popover metadata should label the backend as Runtime");
assert.doesNotMatch(source, /<span>Harness<\/span>/, "Popover should not use harness as the visible product label");

// chat-view wires selection through the existing model-state PATCH channel.
assert.match(chatView, /onSelectModel=\{handleSelectModel\}/, "Chat view passes a select handler");
assert.match(chatView, /method:\s*"PATCH"/, "Selection persists via PATCH");
assert.match(
  chatView,
  /scope:\s*sessionId\s*\?\s*"session"\s*:\s*"familiar-default"/,
  "Selection writes session scope when a chat exists, else familiar-default",
);

// Pill variant — model selection mirrors the familiar selector: a native
// <select> (so the option list opens in the OS layer and can't be clipped by
// the composer card's overflow) with a caret-up-down, in a matching pill.
assert.match(source, /variant\??:\s*"default"\s*\|\s*"pill"/, "ChatModelControl exposes a pill variant");
assert.match(source, /if \(variant === "pill"\)/, "pill variant has a dedicated render branch");
assert.match(source, /<select\b[\s\S]{0,200}cave-chat-model-pill__select|cave-chat-model-pill__select[\s\S]{0,200}<select/, "pill uses a native <select> (opens in a visible OS layer, like the familiar picker)");
assert.match(source, /caret-up-down/, "pill shows a caret-up-down like the familiar selector");
assert.match(css, /\.cave-chat-model-pill\b/, "pill variant has matching CSS");
assert.match(css, /\.cave-chat-model-pill__select/, "pill select has matching CSS");

const homeComposer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
assert.match(homeComposer, /<ChatModelControl[\s\S]{0,160}variant="pill"/, "home composer uses the pill model selector");

console.log("chat-model-control.test.ts: ok");

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

console.log("chat-model-control.test.ts: ok");

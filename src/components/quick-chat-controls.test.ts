// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");

assert.match(source, /StandardSelect/, "quick-chat select helper should delegate to StandardSelect");
assert.doesNotMatch(source, /PopoverBody|PopoverItem|anchorRef|useState\(false\)/, "quick-chat select helper should not maintain its own popover implementation");
assert.match(source, /renderValue=/, "quick-chat select helper should keep its compact trigger rendering through StandardSelect");

// Shared conversation thread — used by both the in-app dropdown and the tray.
assert.match(source, /export function QuickChatThread/, "controls export the shared multi-turn thread renderer");
assert.match(source, /import \{ MarkdownBlock \} from "@\/components\/message-bubble"/, "familiar replies render markdown via the shared MarkdownBlock");
assert.match(source, /copyText\(message\.text\)/, "each familiar reply can be copied to the clipboard");
assert.match(source, /aria-live="polite"/, "the thread is a polite live region so streamed replies are announced");
assert.match(source, /quick-chat-caret|quick-chat-typing/, "streaming turns show a caret / thinking affordance");

console.log("quick-chat-controls.test.ts OK");

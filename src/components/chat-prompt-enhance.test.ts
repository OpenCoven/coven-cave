// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(chatView, /enhancePrompt/, "ChatView defines a composer prompt enhancement action");
assert.match(chatView, /import \{ buildPromptEnhancement \} from "@\/lib\/prompt-enhancer"/, "enhance action uses the shared pure prompt enhancer");
assert.doesNotMatch(chatView, /fetch\("\/api\/prompt\/enhance"/, "enhance action should not round-trip through the API route");
assert.match(chatView, /mode: activeProjectRoot \? "code" : "chat"/, "enhance request is mode-aware for code/project chats");
assert.match(chatView, /selectedFiles: \[\.\.\.mentionedFiles, \.\.\.attachments\.map\(\(attachment\) => attachment\.name\)\]/, "enhance request forwards mentioned and attached file context");
assert.match(chatView, /setInput\(result\.enhanced\)/, "enhanced prompt replaces the draft in the editor");
assert.doesNotMatch(chatView, /enhancePrompt[\s\S]{0,600}send\(/, "enhancing must not send automatically");
assert.match(chatView, /setEnhanceOriginal\(input\)/, "original draft is kept for revert");
assert.match(chatView, /Enhancing prompt\.\.\./, "composer exposes a loading status");
assert.match(chatView, /Prompt improved/, "composer exposes a success status");
assert.match(chatView, /Revert prompt enhancement/, "composer exposes a revert affordance");
assert.match(chatView, /<Icon name="ph:sparkle"/, "Enhance button uses a sparkle icon");

console.log("chat-prompt-enhance.test.ts: ok");

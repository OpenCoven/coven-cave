// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Chat's enhance wiring (cave-b6c2): the composer mounts the shared
// model-backed hook + UI. The hook's lifecycle is pinned in
// use-prompt-enhance.test.ts and the shared UI in composer-enhance.test.ts —
// this file holds chat-view's surface-specific wiring.

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const actionsMenu = readFileSync(new URL("./composer-actions-menu.tsx", import.meta.url), "utf8");

assert.match(chatView, /const promptEnhance = usePromptEnhance\(\{/, "ChatView mounts the shared enhance hook");
assert.match(chatView, /import \{ usePromptEnhance \} from "@\/lib\/use-prompt-enhance"/, "enhance goes through the shared model-backed hook");
assert.doesNotMatch(chatView, /fetch\("\/api\/prompt\/enhance"/, "enhance must not round-trip through the dead API route");
assert.match(chatView, /mode: activeProjectRoot \? "code" : "chat"/, "enhance request is mode-aware for code/project chats");
assert.match(chatView, /selectedFiles: \[\.\.\.mentionedFiles, \.\.\.attachments\.map\(\(attachment\) => attachment\.name\)\]/, "enhance request forwards mentioned and attached file context");
assert.match(chatView, /recentThreadTitle: session\?\.title \?\? null/, "enhance request carries the thread title as context");
assert.match(chatView, /familiarId: familiar\.id/, "enhance streams through the thread's familiar");
assert.match(chatView, /disabled: busy/, "enhance is blocked while a send is in flight");
assert.doesNotMatch(chatView, /onEnhance[\s\S]{0,600}?send\(/, "enhancing must not send automatically");
assert.doesNotMatch(chatView, /ComposerPlusMenu/, "ChatView no longer reaches enhance through the legacy ComposerPlusMenu");
assert.match(
  chatView,
  /<ComposerActionsMenu[\s\S]*?improve=\{\{[\s\S]*?promptSnippets:\s*\{[\s\S]*?enhance:\s*\{[\s\S]*?onEnhance: promptEnhance\.enhance/,
  "ChatView routes enhance through Chat options → Improve",
);
assert.match(actionsMenu, /Smart enhance/, "the Improve section exposes the Smart enhance action");
assert.match(actionsMenu, /ENHANCE_INTENTS\.map\(\(intent\) => \(/, "Enhance options enumerate the shared enhance intents");
assert.match(chatView, /<EnhanceStrip[\s\S]*?onRevert=\{promptEnhance\.revert\}/, "the shared strip carries the revert affordance");

console.log("chat-prompt-enhance.test.ts: ok");

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
assert.match(
  chatView,
  /prepareChatPromptEnhancement\(\s*input,\s*Boolean\(activeProjectRoot\),\s*\)/,
  "Chat prepares prompt-like slash commands before enhancement",
);
assert.match(
  chatView,
  /setInput\(applyChatPromptEnhancement\(\s*\{ commandPrefix: promptEnhancementCommandPrefix \},\s*enhanced,\s*\)\)/,
  "Chat restores the slash-command prefix after enhancement",
);
assert.doesNotMatch(chatView, /fetch\("\/api\/prompt\/enhance"/, "enhance must not round-trip through the dead API route");
assert.match(chatView, /draft: preparedPromptEnhancement\.draft/, "enhance receives only the prepared draft body");
assert.match(chatView, /mode: preparedPromptEnhancement\.mode/, "enhance uses command-aware chat, code, image, or research mode");
assert.match(chatView, /selectedFiles: \[\.\.\.mentionedFiles, \.\.\.attachments\.map\(\(attachment\) => attachment\.name\)\]/, "enhance request forwards mentioned and attached file context");
assert.match(chatView, /recentThreadTitle: session\?\.title \?\? null/, "enhance request carries the thread title as context");
assert.match(chatView, /recentMessages:/, "enhance uses a bounded current conversation window as context");
assert.match(chatView, /recentToolOutcomes:/, "enhance uses bounded settled tool outcomes as context");
assert.match(chatView, /linkedTask:/, "enhance includes the active linked task when available");
assert.match(chatView, /modelScope:/, "enhance fingerprints the composer-local selected model scope");
assert.match(chatView, /familiarId: familiar\.id/, "enhance streams through the thread's familiar");
assert.match(chatView, /disabled: busy/, "enhance is blocked while a send is in flight");
const directEnhanceBlock = chatView.match(/<EnhanceControl[\s\S]*?\/>/)?.[0] ?? "";
assert.match(directEnhanceBlock, /onEnhance=\{promptEnhance\.enhance\}/, "the direct Enhance control uses the shared hook");
assert.doesNotMatch(directEnhanceBlock, /send\(/, "enhancing must not send automatically");
assert.doesNotMatch(directEnhanceBlock, /handleSelectModel|setModel/, "enhancing never changes the composer-local next-message model scope");
assert.doesNotMatch(chatView, /ComposerPlusMenu/, "ChatView no longer reaches enhance through the legacy ComposerPlusMenu");
assert.match(
  chatView,
  /<ComposerActionsMenu[\s\S]*?improve=\{\{[\s\S]*?promptSnippets:\s*\{[\s\S]*?enhance:\s*\{[\s\S]*?onEnhance: promptEnhance\.enhance/,
  "ChatView routes enhance through Chat options → Improve",
);
const addMenu = readFileSync(new URL("./composer-add-menu.tsx", import.meta.url), "utf8");
assert.match(
  actionsMenu,
  /legacy=\{\{[\s\S]*?enhance: improve\.enhance/,
  "the actions menu forwards enhance into the shared add-menu's utility group",
);
assert.match(addMenu, /Enhance prompt/, "the shared add-menu exposes the one-click Enhance prompt action");
assert.match(
  addMenu,
  /PopoverSubmenu[\s\S]{0,200}?label="Enhance options"[\s\S]*?ENHANCE_INTENTS\.map\(\(intent\) => \(/,
  "Enhance options is a cascade submenu enumerating the shared enhance intents",
);
assert.match(chatView, /<EnhanceStrip[\s\S]*?onRevert=\{promptEnhance\.revert\}/, "the shared strip carries the revert affordance");

console.log("chat-prompt-enhance.test.ts: ok");

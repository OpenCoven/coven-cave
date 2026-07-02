// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

const assistantTurnRule = styles.match(/\.cave-turn-assistant\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
const assistantContentRule = styles.match(/\.cave-turn-content\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.ok(assistantTurnRule, "Assistant turn styles should exist");
assert.ok(assistantContentRule, "Assistant content styles should exist");

assert.match(
  assistantTurnRule,
  /width\s*:\s*100%/,
  "Assistant turns should take the full transcript width",
);

assert.doesNotMatch(
  assistantTurnRule,
  /grid-template-columns\s*:\s*32px\s+1fr/,
  "Assistant turns should not reserve a stale avatar column that narrows responses",
);

assert.match(
  assistantContentRule,
  /width\s*:\s*100%/,
  "Assistant responses should span the full pane (full-width chat, 2026-06-12)",
);
assert.doesNotMatch(
  assistantContentRule,
  /(?:width|max-width):\s*(?:min\(100%,\s*)?920px/,
  "The old 920px content cap must stay gone — chat is full width",
);

assert.match(
  source,
  /familiarId: familiar\.id/,
  "ChatView should send the active familiar id to /api/chat/send",
);

assert.match(
  source,
  /async function chatBridgeFailureMessage\(res: Response\): Promise<string>/,
  "ChatView should read non-OK chat bridge response bodies before reporting send failures",
);

assert.match(
  source,
  /const message = await chatBridgeFailureMessage\(res\);[\s\S]*setError\(message\);[\s\S]*label: `Chat bridge rejected the request: \$\{message\}`/,
  "ChatView should surface the server's chat bridge rejection reason in the visible failed turn",
);

assert.match(
  source,
  /raiseDebugError\(\{ turnId: assistantId, code: "NO_STREAM" \}\)/,
  "ChatView should distinguish a missing SSE body from an HTTP rejection",
);

assert.match(
  source,
  /HeaderReflectButton[\s\S]*Reflect on this thread[\s\S]*ph:brain-bold/,
  "ChatView should expose a Reflect action in the chat header",
);

assert.match(
  source,
  /fetch\(`\/api\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/self-report`[\s\S]*sessionId[\s\S]*trigger: "manual"/,
  "Reflect should POST the current session to the self-report API",
);

assert.match(
  source,
  /familiar\.autoSelfReport[\s\S]*trigger: "auto"/,
  "Archived chats should only auto-trigger self-report when the familiar config enables autoSelfReport",
);

assert.match(
  source,
  /catch \{[\s\S]*Auto self-report is best-effort and intentionally silent/,
  "Auto self-report failures should be silent",
);

assert.match(
  source,
  /<ThreadSignalCard[\s\S]*report=\{threadSignalReport\}/,
  "Successful reflection should render the ThreadSignalCard in the transcript",
);

assert.match(
  source,
  /onOpenUrl\?: \(url: string\) => void/,
  "ChatView should accept a URL opener from Workspace so chat links can open in the side-panel browser",
);

assert.match(
  source,
  /<MessageBubble[\s\S]*onOpenUrl=\{onOpenUrl\}/,
  "ChatView should pass the Workspace URL opener into chat message bubbles",
);

assert.match(
  source,
  /useFamiliarImages/,
  "ChatView turn avatars should subscribe to uploaded familiar images",
);

assert.match(
  source,
  /<FamiliarAvatar familiar=\{resolved\} size=\{size\} \/>/,
  "ChatView turn avatars should render uploaded images through FamiliarAvatar before glyph fallback",
);

assert.match(
  source,
  /className=\{`cave-linear-turn-avatar\$\{expanded \? " is-selected" : ""\}`\}/,
  "Selected chat avatars should expose an explicit selected class for enlarged image styling",
);

assert.match(
  styles,
  /\.cave-linear-turn-avatar\.is-selected\s*\{[\s\S]*?width:\s*64px;[\s\S]*?height:\s*64px;/,
  "Selected chat avatar image should grow larger than the default 44px row avatar",
);

assert.match(
  styles,
  /\.cave-linear-turn-avatar-btn\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/,
  "Avatar button should fill the avatar box so selected uploaded images occupy the larger size",
);

assert.doesNotMatch(
  source,
  /native Cave chat only supports Codex, Claude Code, and Hermes right now/,
  "ChatView should allow OpenClaw familiars through native chat send",
);

// REGRESSION (2026-07-01): a no-project chat boots the harness in the
// familiar's own workspace and the daemon records that dir as the session's
// project_root. Echoing the recorded cwd back to /api/chat/send as an
// explicit projectRoot made the server fail closed on the next turn
// ("unregistered project" → 403 project access denied). The send body must
// only assert a root that maps to a registered project or an explicit pick.
assert.match(
  source,
  /const requestProjectRoot =[\s\S]{0,200}activeProjectRoot === session\?\.project_root &&[\s\S]{0,120}!projectIdForRoot\(activeProjectRoot, projects\)/,
  "ChatView should drop a session-echoed cwd that maps to no registered project before sending",
);

assert.match(
  source,
  /projectRoot: requestProjectRoot,/,
  "ChatView should send the vetted requestProjectRoot to /api/chat/send",
);

assert.doesNotMatch(
  source,
  /projectRoot: activeProjectRoot,/,
  "ChatView must not echo the raw activeProjectRoot (session cwd) as an explicit projectRoot",
);

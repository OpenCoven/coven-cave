// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const chat = read("./chat-view.tsx");
const home = read("./home-composer.tsx");
const sessionHeader = read("./chat-session-header.tsx");
const emptyState = read("./chat-empty-state.tsx");
const salem = read("../app/api/salem/route.ts");

assert.match(
  chat,
  /loading: projectsLoading[\s\S]*error: projectsError[\s\S]*loadedSuccessfully: projectsLoadedSuccessfully/,
  "Chat should consume authoritative familiar-scoped project load state",
);
assert.match(
  chat,
  /const projectLaunchReady =[\s\S]*projectsLoadedSuccessfully[\s\S]*!projectsLoading[\s\S]*!projectsError[\s\S]*selectedProject\?\.access/,
  "Chat readiness should require a fresh accessible selected project",
);
assert.match(
  chat,
  /const activeProjectRoot =\s*projectSelection\.unregisteredRoot \?\?\s*selectedProject\?\.root/,
  "an authorized worktree should keep its runtime root while the parent project stays selected",
);
assert.match(
  chat,
  /const requestProjectRoot = projectLaunchReady \? activeProjectRoot : ""/,
  "Chat should only submit the root of a launch-ready project",
);

const sendRawIndex = chat.indexOf("const sendRaw = async");
const sendRawGateIndex = chat.indexOf("if (!projectLaunchReadyForRequest)", sendRawIndex);
const sendRawBusyIndex = chat.indexOf("setBusy(true)", sendRawIndex);
assert.ok(sendRawGateIndex > sendRawIndex, "sendRaw should guard project readiness");
assert.ok(
  sendRawGateIndex < sendRawBusyIndex,
  "sendRaw should reject before creating optimistic turns or starting a request",
);

const sendIndex = chat.indexOf("const send = async");
const sendGateIndex = chat.indexOf("if (!projectLaunchReady)", sendIndex);
const sendMutationIndex = chat.indexOf("pushHistory(text)", sendIndex);
assert.ok(sendGateIndex > sendIndex, "composer send should guard project readiness");
assert.ok(sendGateIndex < sendMutationIndex, "a blocked send must preserve the draft and history");

const voiceIndex = chat.indexOf("const openVoiceCall = useCallback");
const voiceGateIndex = chat.indexOf("projectLaunchRef.current", voiceIndex);
const voiceMintIndex = chat.indexOf("startVoiceConversation(", voiceIndex);
assert.ok(voiceGateIndex > voiceIndex, "voice should read the current project launch gate");
assert.ok(voiceGateIndex < voiceMintIndex, "voice should reject before minting a conversation");
assert.match(
  chat,
  /startVoiceConversation\(requestedFamiliarId, launch\.root\)/,
  "voice mint should use the validated selected/worktree root, not the stale opener prop",
);

const initialPromptIndex = chat.indexOf("// Auto-send a prompt handed off from the home composer.");
const initialReadyIndex = chat.indexOf("if (!projectLaunchReady) return;", initialPromptIndex);
const initialLatchIndex = chat.indexOf("initialPromptSentRef.current = true", initialPromptIndex);
assert.ok(initialReadyIndex > initialPromptIndex, "handoff auto-send should wait for project readiness");
assert.ok(initialReadyIndex < initialLatchIndex, "waiting for a project must not consume the prompt latch");

assert.doesNotMatch(
  chat,
  /\ballowNoProject\b/,
  "Chat project pickers should not offer a project-free launch",
);
assert.doesNotMatch(
  sessionHeader,
  /\ballowNoProject\b/,
  "the active-session project picker should not offer a project-free next turn",
);
assert.doesNotMatch(
  emptyState,
  /\ballowNoProject\b/,
  "the empty-chat project picker should not offer a project-free launch",
);
assert.match(
  chat,
  /disabled=\{!projectLaunchReady \|\| \(!input\.trim\(\) && attachments\.length === 0\)\}/,
  "the typed send control should be disabled without a launchable project",
);
assert.match(
  chat,
  /disabled=\{!projectLaunchReady \|\| voiceCallPending \|\| \(busy && !sessionId\)\}/,
  "the voice control should be disabled without a launchable project",
);

assert.match(
  home,
  /loading: projectsLoading[\s\S]*error: projectsError[\s\S]*loadedSuccessfully: projectsLoadedSuccessfully/,
  "Home should consume authoritative familiar-scoped project load state",
);
assert.match(
  home,
  /const projectLaunchReady = isHomeComposerProjectLaunchReady\(\{[\s\S]*familiarId: selectedFamiliarId[\s\S]*projectsLoadedSuccessfully[\s\S]*projectsLoading[\s\S]*projectsError[\s\S]*selectedProject,/,
  "Home should pass the familiar and authoritative project state to its launch gate",
);
assert.doesNotMatch(home, /\ballowNoProject\b/, "Home should not offer No project for Chat launch");
assert.doesNotMatch(
  home,
  /noProjectId:\s*NO_PROJECT_ID/,
  "Home's alternate project menu should not offer No project",
);
assert.match(
  home,
  /case "chat": \{[\s\S]*if \(!projectLaunchReady\) \{[\s\S]*onToast\(projectLaunchMessage\);[\s\S]*break;[\s\S]*\}[\s\S]*setText\(""\)/,
  "Home Chat handoff should fail before clearing the draft",
);
assert.match(
  home,
  /if \(!projectLaunchReady\) \{[\s\S]*onToast\(projectLaunchMessage\);[\s\S]*return;[\s\S]*\}[\s\S]*setVoiceCallPending\(true\)/,
  "Home voice should fail before setting mint state",
);

assert.match(
  salem,
  /familiarId:\s*args\.familiarId,[\s\S]*origin:\s*"enhance",[\s\S]*permissionMode:\s*"read"/,
  "Ask Salem's hidden docs synthesis should remain projectless and read-only instead of becoming a broken Chat launch",
);

console.log("chat-project-launch-gate.test.ts: ok");

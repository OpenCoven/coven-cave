// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const chat = read("./chat-view.tsx");
const home = read("./home-composer.tsx");
const sessionHeader = read("./chat-session-header.tsx");
const emptyState = read("./chat-empty-state.tsx");

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

assert.match(
  chat,
  /res\.status === 409 &&\s*\(refusal\?\.code === "project_root_unconfirmed" \|\| refusal\?\.code === "project_root_moved"\)\s*\)\s*\{\s*const folderProjectId = refusedUnconfirmedProjectId\(refusal\);\s*setProjectsFixNeeded\(!folderProjectId\);\s*surfacedMessage = refusal\.code === "project_root_moved"[\s\S]{0,500}setFolderConfirm\(folderProjectId \? \{ projectId: folderProjectId, message: surfacedMessage \} : null\);/,
  "a moved folder, or an unconfirmed one the server did not name, offers Projects with code-selected safe copy (#6215)",
);
// #6560: an unconfirmed folder the server named is confirmed in place, through
// useProjects().confirmRoot (the settings route and its Touch ID ceremony),
// and only a successful confirmation retries the refused message.
const confirmIndex = chat.indexOf("const confirmFolderAndRetry = async");
assert.ok(confirmIndex > 0, "Chat should have an in-place Confirm folder handler");
const confirmBody = chat.slice(confirmIndex, chat.indexOf("\n  };\n", confirmIndex));
assert.match(confirmBody, /await confirmRoot\(target\.projectId\)/, "Confirm folder should reuse the settings confirmation");
assert.match(confirmBody, /target\.message !== error/, "a different, later error never inherits the action");
assert.match(confirmBody, /setFolderConfirm\(\{ projectId: target\.projectId, message: result\.error \}\);/, "a declined prompt can be tried again beside its own message");
assert.match(
  confirmBody,
  /if \(!result\.ok\) \{[\s\S]*setError\(result\.error\);[\s\S]*return;[\s\S]*\}[\s\S]*retryFailedSend\(\)/,
  "a declined or unavailable confirmation shows the server's message and never retries",
);
assert.match(
  chat,
  /onConfirmFolder=\{\s*folderConfirm && error === folderConfirm\.message\s*\? \(\) => void confirmFolderAndRetry\(\)\s*: undefined\s*\}/,
  "the error strip offers Confirm folder only beside its own folder message, never a later unrelated error",
);
assert.match(
  chat,
  /\{onConfirmFolder \? \([\s\S]{0,400}onClick=\{onConfirmFolder\}[\s\S]{0,100}disabled=\{confirmingFolder \|\| busy\}[\s\S]{0,700}"Confirm folder"/,
  "the strip's Confirm folder disables while the prompt is open or a send is running",
);
// The Touch ID prompt can stay open while the person keeps working: the
// retry resends only the message that was failing, in the same chat, with no
// newer send in between (#6560 review).
assert.match(confirmBody, /const generation = sendGenerationRef\.current;\s*const chatSession = currentSessionRef\.current;\s*const pending = lastFailedSend;/);
assert.match(
  confirmBody,
  /pending !== null &&\s*sendGenerationRef\.current === generation &&\s*currentSessionRef\.current === chatSession &&\s*lastFailedSendRef\.current === pending;\s*if \(!stillPending\) \{[\s\S]*?return;\s*\}[\s\S]*retryFailedSend\(\)/,
  "a stale confirmation never resends",
);
assert.match(chat, /const projectRootForRequest = requestedProjectRoot;\s*sendGenerationRef\.current \+= 1;\s*setBusy\(true\);/, "every send bumps the generation");
const resets = chat.match(/setProjectsFixNeeded\(false\);\s*setFolderConfirm\(null\);/g) ?? [];
assert.ok(resets.length >= 2, "a new send and Dismiss should both clear the confirm target");
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
  /disabled=\{attachmentsReading \|\| !projectLaunchReady \|\| \(!input\.trim\(\) && attachments\.length === 0\)\}/,
  "the typed send control should be disabled without a launchable project",
);
assert.match(
  chat,
  /disabled=\{!projectLaunchReady \|\| voiceCallPending \|\| \(busy && !sessionId\)\}/,
  "the voice control should be disabled without a launchable project",
);

assert.match(
  home,
  /project: CaveProject \| null;[\s\S]*actingFamiliarId: string \| null;[\s\S]*onRequestActingFamiliar:[\s\S]*onValidateActingFamiliar:/,
  "Home should consume shell-owned project and acting-familiar authority",
);
assert.doesNotMatch(
  home,
  /projectsLoading|projectsError|projectsLoadedSuccessfully|projectLaunchReady/,
  "Home should not recreate shell-owned project loading or eligibility state",
);
assert.doesNotMatch(home, /\ballowNoProject\b/, "Home should not offer No project for Chat launch");
assert.doesNotMatch(
  home,
  /noProjectId:\s*NO_PROJECT_ID/,
  "Home's alternate project menu should not offer No project",
);
assert.match(
  home,
  /if \(!isOmnigentRun && !project\) \{[\s\S]{0,300}?return;\s*\}[\s\S]{0,300}?const actionFamiliar = await resolveActionFamiliar/,
  "Home project-bound submits should fail before requesting an actor or clearing the draft",
);
assert.match(
  home,
  // The no-project block also asks the shell for a project (#5982), so the
  // window before `return` allows for that one extra call.
  /if \(!project\) \{[\s\S]{0,220}?return;\s*\}[\s\S]{0,260}?resolveActionFamiliar\("Start voice call"\)[\s\S]{0,300}?onValidateActingFamiliar[\s\S]{0,180}?setVoiceCallPending\(true\)/,
  "Home voice should require the shell project and validated actor before setting mint state",
);


console.log("chat-project-launch-gate.test.ts: ok");

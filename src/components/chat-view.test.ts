// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = [
  "cave-md",
  "cave-composer",
  "chat-list",
  "calendar",
  "cave-chat/activity",
  "cave-chat/transcript",
  "cave-chat/auxiliary-surfaces",
]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");

const assistantTurnRule = styles.match(/\.cave-turn-assistant\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
const assistantContentRule = styles.match(/\.cave-turn-content\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const sessionHeader = readFileSync(new URL("./chat-session-header.tsx", import.meta.url), "utf8");

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
  /const json = JSON\.parse\(raw\) as \{ error\?: unknown; message\?: unknown; code\?: unknown \}/,
  "ChatView should retain stable server error codes while parsing failed chat launches",
);
assert.match(
  source,
  /typeof json\.code === "string"[\s\S]*?`\$\{json\.code\}: \$\{detail\}`/,
  "ChatView should include a stable launch code in the failure text used by recovery routing",
);

assert.match(
  source,
  /const message = await chatBridgeFailureMessage\(res\);\s+let surfacedMessage = message;[\s\S]*?setError\(surfacedMessage\);[\s\S]*?label: `Chat bridge rejected the request: \$\{message\}`/,
  "ChatView should surface the actionable error while keeping the original bridge rejection detail in the failed-turn label",
);

assert.match(
  source,
  /raiseDebugError\(\{ turnId: assistantId, code: "NO_STREAM" \}\)/,
  "ChatView should distinguish a missing SSE body from an HTTP rejection",
);

const menuModel = readFileSync(new URL("../lib/chat-session-menu-model.ts", import.meta.url), "utf8");
assert.match(
  menuModel,
  /Reflect on this thread/,
  "the menu model exposes a Reflect action for the session overflow menu",
);
// Reflect must not reuse the thinking toggle's brain — two identical brains
// in one menu made the actions indistinguishable. Sparkle matches the daily
// note's Reflection section where reflections land. The voice call is a
// direct header button (cave-zolo), so the phone icon lives beside — not
// inside — the menu.
assert.match(
  menuModel,
  /ctx\.reflecting \? "ph:circle-notch-bold" : "ph:sparkle-bold"/,
  "the Reflect action keeps its sparkle (spinner while reflecting), distinct from the thinking brain",
);
assert.match(
  sessionHeader,
  /function VoiceCallButton[\s\S]{0,900}ph:phone/,
  "the voice call is a direct header button with the phone icon",
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
  /<div className="cave-thread-signal-overlay">[\s\S]*<ThreadSignalCard[\s\S]*report=\{threadSignalReport\}/,
  "Successful reflection should render the ThreadSignalCard in the chat overlay",
);

assert.ok(
  source.indexOf('<div ref={tailRef} />') < source.indexOf('<div className="cave-thread-signal-overlay">'),
  "Thread Signal should render after the transcript tail rather than inside the conversation log",
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

// FamiliarIcon (the override-aware avatar wrapper) was extracted to
// familiar-icon.tsx so the chat empty state can share it; the turn avatars
// still render through it, so the image-pipeline pins follow the wrapper.
const familiarIconSource = readFileSync(
  new URL("./familiar-icon.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /<FamiliarIcon familiar=\{familiar\} size="sm" \/>/,
  "ChatView turn avatars should render through the shared FamiliarIcon wrapper",
);

assert.match(
  familiarIconSource,
  /useFamiliarImages/,
  "FamiliarIcon should subscribe to uploaded familiar images",
);

assert.match(
  familiarIconSource,
  /<FamiliarAvatar familiar=\{resolved\} size=\{size\} \/>/,
  "FamiliarIcon should render uploaded images through FamiliarAvatar before glyph fallback",
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

// Every outgoing root is now gated by a freshly loaded project carrying this
// familiar's effective access. Historical unregistered cwd sessions remain
// readable, but never ride a next-turn request until repaired.
assert.match(
  source,
  /const requestProjectRoot = projectLaunchReady \? activeProjectRoot : ""/,
  "ChatView should only submit the root of a current accessible project",
);

assert.match(
  source,
  /projectRoot: requestProjectRoot,/,
  "ChatView should send the vetted requestProjectRoot to /api/chat/send",
);

assert.doesNotMatch(
  source,
  /body: JSON\.stringify\(\{[\s\S]{0,400}?projectRoot: activeProjectRoot,/,
  "ChatView must not echo the raw activeProjectRoot (session cwd) as the send request's explicit projectRoot",
);

// A worktree executes from its checkout while the registered parent project
// supplies the authorization and visible access level.
assert.match(
  source,
  /const activeProjectRoot =\s*projectSelection\.unregisteredRoot \?\?\s*selectedProject\?\.root/,
  "ChatView should keep an authorized worktree hand-off as the active root",
);

// ── #2618: a failed chat send keeps the user in-chat with the message preserved,
// and the coven-CLI-missing case offers a soft "Open Setup" link (overlay, not a
// hard navigation to the wizard). ──────────────────────────────────────────────
assert.match(
  source,
  /setLastFailedSend\(request\);/,
  "a failed send preserves the request so the composer message can be retried",
);
assert.match(
  source,
  /const runtimeMissing = useMemo\([\s\S]{0,500}?code === "runtime_missing"[\s\S]{0,500}?Coven CLI \(\?:not found on PATH\|was found as a Windows launcher shim\|is installed as a Windows command shim\)[\s\S]{0,500}?Windows PowerShell was not found at its system location, so Coven CLI cannot be launched[\s\S]{0,500}?code === "ENOENT"/,
  "the error strip offers Setup for missing and known-unlaunchable Coven launchers",
);
assert.match(
  source,
  /onOpenSetup=\{\(\) => window\.dispatchEvent\(new CustomEvent\("cave:onboarding-open"\)\)\}/,
  "Open Setup opens the wizard as a soft overlay event, never a route change",
);
assert.doesNotMatch(
  source,
  /router\.(push|replace)\([`"'][^`"']*onboard/i,
  "a send failure must never hard-navigate the router to onboarding",
);

// ── cave-yjnr: a 400 project_root_required (analytics-opened thread with no
// root anywhere) must not dead-end at jargon + a Retry that can never work.
// The strip swaps in plain copy and an inline project picker that adopts the
// chosen project and re-sends the failed message explicitly rooted there. ────
assert.match(
  source,
  /\(res\.status === 400 \|\| res\.status === 403\)[\s\S]{0,180}project_root_required\|project_not_registered\|project_access_denied\|projectRoot is required[\s\S]{0,180}setProjectRootRequired\(true\)/,
  "repairable project launch rejections flip the inline-resolve state instead of surfacing server jargon",
);
assert.match(
  source,
  /project_root_required\|project_not_registered\|project_access_denied\|projectRoot is required/,
  "every repairable project launch rejection routes to the accessible-project picker",
);
assert.match(
  source,
  /function handlePickProjectFix\(projectId: string\) \{[\s\S]*?setProjectIdDraft\(projectId\);[\s\S]*?void sendRaw\(\s*failed\.text,[\s\S]*?projectRoot: project\.root,[\s\S]*?\n  \}/,
  "picking a project from the strip adopts it as the chat's selection and retries the failed send rooted there",
);
assert.match(
  source,
  /onPickProject=\{projectRootRequired \? handlePickProjectFix : undefined\}/,
  "the inline project picker only renders for the projectRoot-required failure class",
);
assert.match(
  source,
  /projectRootRequired && projects\.length === 0\s*\? overflowAddProject\.beginAddProject/,
  "with zero registered projects the strip offers the shared register-a-folder flow instead of a dead select",
);

// ── In-place project setup for ad-hoc chat homes (spec 2026-07-24) ──────────
// Eligibility comes from the pure helper on the RESOLVED selection — so
// registered projects, familiar workspaces (no unregisteredRoot), and
// project worktrees never see the offer.
assert.match(
  source,
  /projectSetupCandidateRoot\(projectSelection, projects\)/,
  "the setup offer derives from the resolved selection via the pure helper",
);
// Banner dismissal persists per normalized root, so one folder never re-nags.
assert.match(
  source,
  /projectSetupDismissKey\(setupCandidateRoot\)/,
  "banner dismissal keys on the shared per-root helper",
);
assert.match(
  source,
  /Set up as project…/,
  "the banner offers setup in one click",
);
// Success rescopes the chat to the new project — same contract as the shared
// add flow (draft set + registry reload).
assert.match(
  source,
  /<ProjectSetupModal[\s\S]*?onCreated=\{\(newProjectId\) => \{\s*setProjectIdDraft\(newProjectId\);\s*reloadProjects\(\);/,
  "a created project becomes the chat's next-send selection",
);
// Both picker hosts (composer chips + session kebab) surface the register row.
assert.match(
  source,
  /<ComposerContextChips[\s\S]*?registerCurrentRoot=\{setupCandidateRoot \?\? undefined\}/,
  "composer chips carry the register-current-folder affordance",
);
assert.match(
  source,
  /<SessionOverflowMenu(?:(?!\/>)[\s\S])*?registerCurrentRoot=\{setupCandidateRoot \?\? undefined\}/,
  "the session kebab picker carries it too",
);
assert.match(
  source,
  /<ProjectSetupModal[\s\S]*?createProject=\{createProjectOrThrow\}/,
  "the setup modal gets the throwing create variant for real error messages",
);
assert.match(
  source,
  /const overflowAddProject = useAddProjectFlow\(\{[\s\S]*?createProject,[\s\S]*?createProjectOrThrow,/,
  "the chat overflow add flow preserves local-only creation guidance",
);
assert.match(
  source,
  /<ComposerContextChips[\s\S]*?createProject=\{createProject\}[\s\S]*?createProjectOrThrow=\{createProjectOrThrow\}/,
  "the primary chat composer picker receives the throwing creator",
);
assert.match(
  source,
  /<ChatEmptyState[\s\S]*?createProject=\{createProject\}[\s\S]*?createProjectOrThrow=\{createProjectOrThrow\}/,
  "the chat empty-state picker receives the throwing creator",
);
assert.match(source, /\{overflowAddProject\.addError \? \(/, "the chat overflow picker renders add-project failures");

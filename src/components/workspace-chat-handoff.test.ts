// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const railController = await readFile(new URL("../lib/use-workspace-rail-controller.ts", import.meta.url), "utf8");
const pendingChatActionLib = await readFile(new URL("../lib/pending-chat-action.ts", import.meta.url), "utf8");
const pendingCodeOpenLib = await readFile(new URL("../lib/pending-code-open.ts", import.meta.url), "utf8");
const codeView = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
const codeWorkbench = await readFile(new URL("./code-workbench.tsx", import.meta.url), "utf8");
const codeWorkbenchFiles = await readFile(new URL("./code-workbench-files.tsx", import.meta.url), "utf8");
const workspaceRail = await readFile(new URL("./workspace-rail.tsx", import.meta.url), "utf8");
const railFilesPanel = await readFile(new URL("./rail-files-panel.tsx", import.meta.url), "utf8");

assert.match(
  pendingChatActionLib,
  /export type PendingChatAction =[\s\S]*kind: "new"[\s\S]*kind: "open"[\s\S]*kind: "list"/,
  "PendingChatAction should be defined once in the shared lib so Workspace and ChatSurface cannot drift",
);

assert.match(
  pendingChatActionLib,
  /initialControls\?: InitialCommandControls \| null/,
  "PendingChatAction should carry initial command controls for Home-started chats",
);

assert.match(
  workspace,
  /import type \{ PendingChatAction \} from "@\/lib\/pending-chat-action"/,
  "Workspace should import the shared PendingChatAction type instead of redeclaring it",
);

assert.match(
  chatSurface,
  /import type \{ PendingChatAction \} from "@\/lib\/pending-chat-action"/,
  "ChatSurface should import the shared PendingChatAction type instead of redeclaring it",
);

assert.doesNotMatch(
  workspace,
  /^type PendingChatAction =/m,
  "Workspace must not redeclare PendingChatAction locally",
);

assert.doesNotMatch(
  chatSurface,
  /^type PendingChatAction =/m,
  "ChatSurface must not redeclare PendingChatAction locally",
);

assert.match(
  workspace,
  /const \[pendingChatAction, setPendingChatAction\] = useState<PendingChatAction>\(null\)/,
  "Workspace should keep pending chat actions in state so ChatSurface can consume them after mounting",
);

assert.match(
  workspace,
  /const startFamiliarChat = useCallback\([\s\S]*if \(chatProjectBlockedRef\.current\) \{[\s\S]*setMode\("home"\);[\s\S]*return;[\s\S]*\}[\s\S]*setPendingChatAction\(\{[\s\S]*kind: "new"[\s\S]*familiarId[\s\S]*projectRoot[\s\S]*nonce: Date\.now\(\)[\s\S]*\}\)[\s\S]*setMode\("chat"\)/,
  "New chat should enqueue a pending chat action before entering chat mode",
);

assert.match(
  workspace,
  /startFamiliarChat = useCallback\(\([\s\S]*?initialControls\?: InitialCommandControls \| null,[\s\S]*?initialControls,[\s\S]*?setMode\("chat"\)/,
  "Workspace should carry initial controls through the pending new-chat action",
);

assert.match(
  workspace,
  /CustomEvent<\{[\s\S]*?initialControls\?: InitialCommandControls \| null[\s\S]*?\}>[\s\S]*?startFamiliarChat\([\s\S]*?d\?\.initialControls \?\? null[\s\S]*?\)/,
  "Workspace non-chat bridge should carry initial controls from cave:agents-new-chat into startFamiliarChat",
);

assert.match(
  workspace,
  /<HomeComposer[\s\S]*?onStartChat=\{\(prompt, fid, projectRoot, opts\) =>\s*startFamiliarChat\(fid, projectRoot, prompt, opts\?\.initialControls \?\? null, opts\?\.initialAttachments \?\? null\)\s*\}/,
  "Workspace HomeComposer handoff should forward initial controls + attachments into startFamiliarChat",
);

assert.match(
  workspace,
  /const openFamiliarSession = useCallback\([\s\S]*setPendingChatAction\(\{[\s\S]*kind: "open"[\s\S]*sessionId[\s\S]*familiarId[\s\S]*nonce: Date\.now\(\)[\s\S]*\}\)[\s\S]*setMode\("chat"\)/,
  "Opening a session should enqueue a pending chat action before entering chat mode",
);

assert.match(
  workspace,
  /const showFamiliarChatList = useCallback\([\s\S]*setPendingChatAction\(\{ kind: "list", nonce: Date\.now\(\) \}\)[\s\S]*setMode\("chat"\)/,
  "Showing the chat list should enqueue a pending chat action before entering chat mode",
);

assert.doesNotMatch(
  workspace,
  /window\.dispatchEvent\(\s*new CustomEvent\("cave:agents-(?:new-chat|open-session|list)"/,
  "Workspace should not dispatch chat navigation events before ChatSurface has mounted",
);

assert.match(
  workspace,
  /pendingChatAction=\{pendingChatAction\}[\s\S]*onPendingChatActionHandled=\{\(\) => setPendingChatAction\(null\)\}/,
  "Workspace should pass pending chat actions into ChatSurface and clear them after consumption",
);

assert.match(
  chatSurface,
  /pendingChatAction\?: PendingChatAction/,
  "ChatSurface should accept pending chat actions from Workspace",
);

assert.match(
  chatSurface,
  /useEffect\(\(\) => \{[\s\S]*if \(!pendingChatAction\) return[\s\S]*pendingChatAction\.kind === "new"[\s\S]*routerRef\.current\?\.newChat[\s\S]*pendingChatAction\.kind === "open"[\s\S]*routerRef\.current\?\.openSession[\s\S]*routerRef\.current\?\.goToList[\s\S]*onPendingChatActionHandled\(\)/,
  "ChatSurface should consume pending chat actions after it is mounted",
);

assert.match(
  chatSurface,
  /routerRef\.current\?\.newChat\([\s\S]*?pendingChatAction\.initialControls \?\? undefined/,
  "ChatSurface should pass pending initial controls into ChatRouter.newChat",
);

// File/diff links land on the Code surface (cave-ohcj) — from ANY mode,
// including chat. Workspace keeps the event detail (plus the raising chat
// session) in state long enough for CodeView to mount and route it into the
// right session's workbench.
assert.match(
  pendingCodeOpenLib,
  /export type PendingCodeOpen =[\s\S]*kind: "files"[\s\S]*sessionId\?: string[\s\S]*kind: "changes"[\s\S]*path: string[\s\S]*sessionId\?: string[\s\S]*nonce: number/,
  "PendingCodeOpen should be defined once in the shared lib and carry the raising session",
);
assert.match(
  workspace,
  /import type \{ PendingCodeOpen \} from "@\/lib\/pending-code-open"/,
  "Workspace should import the shared pending code open type",
);
assert.doesNotMatch(
  chatSurface,
  /PendingCodeRailOpen|PendingCodeOpen|pendingCodeRailOpen/,
  "ChatSurface no longer participates in file/diff open routing (cave-ohcj)",
);
assert.match(
  workspace,
  /const \[pendingCodeOpen, setPendingCodeOpen\] = useState<PendingCodeOpen \| null>\(null\)/,
  "Workspace should retain file/diff open detail across the mode switch into code",
);
assert.match(
  workspace,
  /window\.addEventListener\("cave:open-project-file", onOpenProjectFile as EventListener\);[\s\S]*window\.addEventListener\("cave:open-file-diff", onOpenFileDiff as EventListener\);/,
  "Workspace should bridge both file preview and diff events",
);
assert.match(
  workspace,
  /const sessionId = activeChatSessionIdRef\.current \?\? undefined;[\s\S]*setPendingCodeOpen\([\s\S]*kind === "files"[\s\S]*path: detail\.path[\s\S]*line: detail\.line[\s\S]*sessionId[\s\S]*path: detail\.path[\s\S]*sessionId[\s\S]*nonce: Date\.now\(\)[\s\S]*\);[\s\S]*setMode\("code"\)/,
  "Workspace should attach the raising chat session and switch into code mode",
);
assert.match(
  workspace,
  /pendingOpen=\{pendingCodeOpen\}[\s\S]*onPendingOpenHandled=\{\(\) => setPendingCodeOpen\(null\)\}/,
  "Workspace should pass pending file/diff opens into CodeView and clear them after consumption",
);
assert.match(
  railController,
  /openTarget[\s\S]*rail\.reopen\(\)[\s\S]*rail\.setActiveTab\(target\.kind === "changes" \? "changes" : "files"\)[\s\S]*setFocus/,
  "The shared rail controller should reopen the code rail, select Files/Changes, and store the focused path",
);
assert.doesNotMatch(
  railController,
  /addEventListener\("cave:open-project-file"|addEventListener\("cave:open-file-diff"|addEventListener\("cave:browse-project-files"/,
  "the rail controller no longer consumes global file/diff/browse open events (cave-ohcj)",
);
assert.match(
  railController,
  /window\.addEventListener\("cave:changes-open", openChanges\)/,
  "the rail controller keeps its surface-internal show-changes affordance",
);
assert.match(
  codeView,
  /if \(!pendingOpen\) return;[\s\S]*pendingOpen\.sessionId[\s\S]*\.find\(\(row\) => row\.id === pendingOpen\.sessionId\)[\s\S]*setTopTab\("sessions"\);[\s\S]*if \(target\) setSelectedId\(target\.id\);[\s\S]*onPendingOpenHandled\?\.\(\)/,
  "CodeView should consume pending opens by selecting the raising session's workbench",
);
assert.match(
  codeView,
  /openTarget=\{\s*workbenchTarget && \(workbenchTarget\.sessionId \?\? selected\.id\) === selected\.id\s*\? workbenchTarget\.open\s*: undefined\s*\}/,
  "CodeView should hand the open target only to the session it resolved to",
);
assert.match(
  codeWorkbench,
  /if \(!openTarget\) return;[\s\S]*setTab\(openTarget\.kind === "changes" \? "diff" : "files"\)/,
  "the workbench should land a routed open on the Diff or Files tab",
);
assert.match(
  codeWorkbench,
  /<SessionChangesInner[\s\S]*focusPath=\{openTarget\?\.kind === "changes" \? openTarget\.path : undefined\}[\s\S]*focusNonce=\{openTarget\?\.kind === "changes" \? openTarget\.nonce : undefined\}/,
  "the workbench should focus diff targets in its Diff tab",
);
assert.match(
  codeWorkbench,
  /<LazyFilesTab[\s\S]*focusPath=\{openTarget\?\.kind === "files" \? openTarget\.path : undefined\}[\s\S]*focusNonce=\{openTarget\?\.kind === "files" \? openTarget\.nonce : undefined\}/,
  "the workbench should focus file targets in its Files tab",
);
assert.match(
  codeWorkbenchFiles,
  /focusPath\?: string \| null[\s\S]*focusNonce\?: number[\s\S]*useEffect\(\(\) => \{[\s\S]*if \(!focusPath\) return;[\s\S]*openPath\(focusPath\)/,
  "the workbench Files tab should select an externally focused path",
);

// cave-z44: Projects hub "Browse files" drills into a project ROOT (no file).
// The shared type carries an optional root; Workspace bridges the event into
// code mode; CodeView picks that root's newest session (or degrades to the
// surface with no workbench focus when none exists).
assert.match(
  pendingCodeOpenLib,
  /kind: "files";[\s\S]*root\?: string;/,
  "the shared type carries an optional browse root on the files open",
);
assert.match(
  workspace,
  /window\.addEventListener\("cave:browse-project-files", onBrowseProjectFiles as EventListener\)/,
  "Workspace bridges the Projects-hub browse-files event into code mode",
);
assert.match(
  workspace,
  /onBrowseProjectFiles = \(e: Event\) => \{[\s\S]*if \(!detail\?\.root\) return;[\s\S]*setPendingCodeOpen\(\{ kind: "files", root: detail\.root, nonce: Date\.now\(\) \}\)[\s\S]*setMode\("code"\)/,
  "Workspace preserves the browse root and switches to code",
);
assert.match(
  codeView,
  /const byRoot =[\s\S]*trim\(codeSessionWorkRoot\(row\)\) === trim\(root\)/,
  "CodeView resolves a browse root to the newest session working in it",
);
assert.match(
  codeView,
  /setWorkbenchTarget\(root && !target \? null : \{ open: pendingOpen, sessionId: target\?\.id \?\? null \}\)/,
  "a browse root with no matching session degrades to the surface without a stale focus",
);
assert.match(
  chatSurface,
  /<WorkspaceRail[\s\S]*focus=\{codeRailFocus\}/,
  "ChatSurface should thread the focused file/diff target into WorkspaceRail",
);
assert.match(
  workspaceRail,
  /focus\?: CodeRailFocus \| null[\s\S]*<SessionChangesPanel[\s\S]*focusPath=\{focus\?\.kind === "changes" \? focus\.path : null\}[\s\S]*focusNonce=\{focus\?\.kind === "changes" \? focus\.nonce : undefined\}/,
  "WorkspaceRail should focus diff targets in the Changes tab",
);
assert.match(
  workspaceRail,
  /<RailFilesPanel[\s\S]*focusPath=\{focus\?\.kind === "files" \? focus\.path : null\}[\s\S]*focusLine=\{focus\?\.kind === "files" \? focus\.line : undefined\}[\s\S]*focusNonce=\{focus\?\.kind === "files" \? focus\.nonce : undefined\}/,
  "WorkspaceRail should focus file targets in the Files tab",
);
assert.match(
  railFilesPanel,
  /focusPath\?: string \| null[\s\S]*focusNonce\?: number[\s\S]*useEffect\(\(\) => \{[\s\S]*setSelectedPath\([\s\S]*focusPath/,
  "RailFilesPanel should update its selected file from an external focus target",
);

// Cross-page handoff (cave-hbpb): standalone routes (familiar analytics) have no
// cave:agents-new-chat listener — they persist the request and navigate to /,
// where Workspace must consume it at boot into a primed chat.
const agentsNewChatLib = await readFile(new URL("../lib/agents-new-chat.ts", import.meta.url), "utf8");
assert.match(
  agentsNewChatLib,
  /window\.location\.pathname === "\/"[\s\S]*dispatchEvent\(new CustomEvent\(AGENTS_NEW_CHAT_EVENT/,
  "same-page callers keep dispatching the live event",
);
assert.match(
  agentsNewChatLib,
  /sessionStorage\.setItem\(PENDING_AGENTS_NEW_CHAT_KEY[\s\S]*window\.location\.assign\("\/"\)/,
  "off-page callers persist the request and navigate to the workspace",
);
assert.match(
  workspace,
  /import \{ consumePendingAgentsNewChat \} from "@\/lib\/agents-new-chat"/,
  "Workspace should import the cross-page chat handoff consumer",
);
assert.match(
  workspace,
  /const pending = consumePendingAgentsNewChat\(\);[\s\S]{0,200}startFamiliarChat\(\s*pending\.familiarId \?\? null,\s*pending\.projectRoot \?\? null,\s*pending\.initialPrompt \?\? null,\s*pending\.initialControls \?\? null,?\s*\)/,
  "Workspace boot should turn a pending cross-page request into a primed familiar chat",
);
// The bridge effect registers BOTH cave:agents-new-chat and
// cave:continue-on-phone; its cleanup must remove both or re-runs/remounts
// leak continue-on-phone handlers (duplicate pairing-modal opens).
assert.match(
  workspace,
  /return \(\) => \{\s*window\.removeEventListener\("cave:agents-new-chat", onAgentsNewChat\);\s*window\.removeEventListener\("cave:continue-on-phone", onContinueOnPhone as EventListener\);\s*\};/,
  "Workspace bridge cleanup should remove every listener the effect adds",
);

// Source-text pins for the Coding Desk overhaul (#5705). Each guards a
// contract the surface would be sad to lose silently; the behaviour itself is
// exercised by tests/code-desk.spec.ts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workbench = await readFile(new URL("./code-workbench.tsx", import.meta.url), "utf8");
const reviewRail = await readFile(new URL("./code-review-rail.tsx", import.meta.url), "utf8");
const composer = await readFile(new URL("./code-composer.tsx", import.meta.url), "utf8");
const drawer = await readFile(new URL("./code-terminal-drawer.tsx", import.meta.url), "utf8");
const tabs = await readFile(new URL("./code-open-file-tabs.tsx", import.meta.url), "utf8");
const roomCss = await readFile(new URL("../styles/globals/surface-code-room.css", import.meta.url), "utf8");
const shortcuts = await readFile(new URL("../lib/code-shortcuts.ts", import.meta.url), "utf8");

// 1. The desk fills its host. `flex: 1` was inert under a block host.
assert.match(
  roomCss,
  /\.code-room \{[^}]*height: 100%;/,
  "the desk owns its host's full height — without it the composer floats above dead space",
);

// 2. Identity strip: every tone is paired with a word, and the retired facts row is gone.
assert.match(workbench, /const identity = codeDeskIdentity\(row, changes\);/, "the header renders from the shared identity model, fed the live worktree summary so its diffstat matches the rail (#5718)");
assert.match(
  workbench,
  /data-tone=\{identity\.activity\.tone\}[\s\S]{0,300}\{identity\.activity\.word\}/,
  "the activity pill prints the state word beside its tone",
);
assert.match(
  workbench,
  /data-state=\{identity\.pr\.state\}[\s\S]{0,400}\{identity\.pr\.state\}<\/span>/,
  "the PR chip prints the state word (open/draft/merged/closed), not just a tint",
);
assert.doesNotMatch(workbench, /code-room__facts/, "the monospace facts row is retired, not hidden");

// 3. Open-file tabs sit above the viewer and are driven by the pure model.
assert.match(
  workbench,
  /<CodeOpenFileTabs[\s\S]*?onClose=\{closeTab\}[\s\S]*?\/>[\s\S]{0,200}?<div\s+className="code-room__viewer-panel"[\s\S]{0,300}?>\s*<RailFilePreview/,
  "the tab strip renders directly above the file viewer",
);
assert.match(workbench, /setOpenFiles\(\(current\) => openCodeFile\(current, absolute\)\)/, "opening a path goes through openCodeFile");
// Since #5756 the seed also opens a tab for each unsaved draft under the root.
assert.match(workbench, /const \[initialOpenFiles\] = useState<CodeOpenFiles>\(\(\) =>\s*withDraftTabs\(codeDeskMemory\.read\(row\.id\)\?\.openFiles \?\? emptyCodeOpenFiles\(\),/, "tabs are per session — seeded once from that session's memory, or empty");
assert.match(workbench, /const \[openFiles, setOpenFiles\] = useState<CodeOpenFiles>\(initialOpenFiles\);/, "the tab strip starts from that seed");
assert.match(
  workbench,
  /const openPath = useCallback\([\s\S]*?setSelectedPath\(absolute\);\s*setFocusLine\(null\);\s*setRangeLabel\(null\);/,
  "ordinary file opens clear the previous file's focus and range",
);
assert.match(
  workbench,
  /openPath\(openTarget\.path\);[\s\S]*?setFocusLine\(openTarget\.line \?\? null\);[\s\S]*?setRangeLabel\(openTarget\.origin\?\.selectionLabel \?\? null\);/,
  "routed opens apply their own focus and range after openPath clears stale context",
);
assert.match(tabs, /role="tablist" aria-label="Open files"/, "the strip is a real tablist");
// Delete on the tab closes it, and says so; the close button is the pointer's
// way, out of the tablist's accessibility tree (#5781), its tooltip naming
// the file.
assert.match(tabs, /aria-keyshortcuts="Delete"/, "the tab advertises Delete to close");
assert.match(tabs, /aria-hidden="true"\s*title=\{`Close \$\{describeHiddenUnicode\(label\)\}`\}/, "each close control names its file to the pointer");
assert.match(shortcuts, /\{ id: "next-file", label: "Next open file", combo: "Alt\+ArrowDown" \}/, "next-file is rebindable and defaults off the browser's tab-switch keys");
assert.match(shortcuts, /\{ id: "previous-file", label: "Previous open file", combo: "Alt\+ArrowUp" \}/, "previous-file is rebindable");
assert.match(workbench, /action === "next-file"[\s\S]{0,60}cycleTab\(1\)/, "the room wires next-file to the tab model");

// 4. The follow-up dock: persistent label, context chip, seeded suggestions, built prompt.
assert.match(composer, /<label className="code-composer__label" htmlFor=\{`\$\{id\}-prompt`\}>\s*Follow-up/, "the textarea has a persistent visible label — a placeholder is not a label");
assert.match(composer, /const outgoing = buildCodeFollowUp\(\{ prompt, contextPath, rangeLabel, includeContext \}\);/, "the outgoing text is built by the pure model so the chip's effect is pinned");
assert.match(composer, /prompt: outgoing,/, "the built text is what rides to /api/chat/send");
assert.match(composer, /aria-pressed=\{attached\}/, "the context chip is a toggle with exposed state");
assert.match(composer, /\{attached \? "attached" : "not attached"\}/, "the chip's state is a word, not only a tint");
assert.match(composer, /setPrompt\(suggestion\.prompt\);\s*textareaRef\.current\?\.focus\(\);/, "a suggestion seeds the prompt and focuses it — it never sends");
assert.match(composer, /role="status" data-phase=\{phase\}[\s\S]{0,600}\{CODE_COMPOSER_STATUS\[phase\]\}/, "the reply card carries a status word");
assert.match(composer, /placeholder=\{busy \? "The familiar is working…" : "Ask for follow-up changes…"\}/, "the placeholder is unchanged");
assert.match(
  workbench,
  /<CodeComposer[\s\S]{0,400}contextPath=\{selectedRelative\}[\s\S]{0,200}hasChanges=\{[^}]*\}[\s\S]{0,100}hasPr=\{Boolean\(pr\)\}/,
  "the workbench hands the composer the open file and the session's state",
);

// 5. The terminal drawer: resizable, clamped to the room, remembered.
assert.match(drawer, /role="separator"[\s\S]{0,200}aria-orientation="horizontal"[\s\S]{0,700}onKeyDown=\{onGripKeyDown\}/, "the grip is keyboard-operable");
assert.match(drawer, /setHeightPx\(readCodeTerminalHeight\(safeStorage\(\)\)\);/, "the remembered height is read after mount");
assert.match(drawer, /if \(!open\) return;\s*setHeightPx\(\(current\) => clampCodeTerminalHeight\(current, roomHeightPx\)\);\s*\}, \[open, roomHeightPx\]\);/, "the drawer re-clamps only while open, so closing it never shrinks the height (#5729)");
assert.match(drawer, /writeCodeTerminalHeight\(safeStorage\(\), clamped\);/, "commits persist the clamped height");
assert.match(drawer, /aria-valuemin=\{clampCodeTerminalHeight\(CODE_TERMINAL_MIN_HEIGHT_PX, roomHeightPx\)\}/, "the accessible minimum respects an undersized room's ceiling");
assert.match(drawer, /visible=\{open\}/, "the workspace still hides via its keepalive prop, never by unmounting");
assert.match(workbench, /const bodyHeight = useMeasuredHeight\(roomRef\);[\s\S]*bodyHeightPx=\{bodyHeight\}/, "the drawer is bounded by the column body it shares space with, not the whole desk");
assert.match(drawer, /const roomHeightPx = bodyHeightPx == null \? null : bodyHeightPx \+ \(open \? heightPx : 0\);/, "the ceiling is 70% of the body plus the drawer — the region they share");
assert.match(roomCss, /\.code-room__body \{[^}]*overflow: hidden;/, "the columns clip to their box, so nothing paints over the drawer");

// 6. Review progress: viewed state is the workbench's, the rail is controlled.
assert.match(workbench, /const \[viewed, setViewed\] = useState<CodeRailViewedState>\(\(\) => codeDeskMemory\.read\(row\.id\)\?\.viewed \?\? \{\}\);/, "the workbench owns per-file viewed state, seeded from the session's memory");
assert.doesNotMatch(workbench, /\}, \[row\.id\]\);/, "no effect re-applies per-session state: the workbench is keyed per session, and under StrictMode such an effect reset a routed open's rail focus (#5729)");
assert.doesNotMatch(workbench, /railFiles/, "every progress figure — count, next file, completion tint — reads the room's live changes summary");
assert.doesNotMatch(reviewRail, /useState<CodeRailViewedState>/, "the rail no longer keeps its own viewed state");
assert.match(reviewRail, /viewed=\{viewed\}\s*onToggleViewed=\{onToggleViewed\}/, "the changes panel is wired to the lifted state");
assert.match(reviewRail, /onFilesChange=\{onPanelFilesChange\}/, "the rail reports the panel's own snapshot up so the room can reconcile it");
assert.match(workbench, /useEffect\(\(\) => \{\s*if \(panelKey === null \|\| panelKey === roomKeyRef\.current\) return;\s*refreshRoomRef\.current\(\);\s*\}, \[panelKey\]\);/, "the panel leads: only a change in ITS snapshot that disagrees with the room refetches the room, once (#5729)");
assert.doesNotMatch(workbench, /cave:changes-refresh/, "the desk no longer forces both lists to refetch on a disagreement (#5729)");
assert.match(workbench, /toggleCodeRailViewed\(current, codeRailShapeOf\(file\)\)/, "viewed ticks are recorded against the file's filesystem stamp too");
assert.match(reviewRail, /addEventListener\("pointercancel", end/, "a cancelled touch or pen drag releases the rail grip too");
assert.match(reviewRail, /disabled=\{!nextUnviewed\}/, "Next unviewed disables itself once every file is viewed");
assert.match(workbench, /const nextUnviewedShape = nextUnviewedCodeFile\(railFileShapes, viewed, selectedRelative\);/, "the next file comes from the pure model, relative to the file in the viewer");
assert.match(workbench, /openPath\(absolutePath\(changesBase, nextUnviewed\.path\)\);[\s\S]{0,400}setReviewFocus\(/, "Next unviewed opens the file in the viewer AND focuses its diff in the rail");
assert.match(workbench, /data-testid="code-desk-progress"/, "the header prints review progress");

// ── Pass 2 (#5718) ───────────────────────────────────────────────────────────
const composerSrc = composer;
const workspace = await readFile(new URL("./code-terminal-workspace.tsx", import.meta.url), "utf8");
const preview = await readFile(new URL("./rail-file-preview.tsx", import.meta.url), "utf8");

// 1. A session round trip keeps tabs, ticks and the draft.
assert.match(workbench, /useEffect\(\(\) => \{\s*codeDeskMemory\.write\(row\.id, \{ openFiles, viewed \}\);\s*\}, \[openFiles, row\.id, viewed\]\);/, "tabs and ticks are written to the session's memory as they change");
assert.match(workbench, /initialDraft=\{codeDeskMemory\.read\(row\.id\)\?\.draft \?\? ""\}[\s\S]{0,120}onDraftChange=\{\(draft\) => codeDeskMemory\.write\(row\.id, \{ draft \}\)\}/, "the composer's draft is remembered per session");
assert.match(composerSrc, /const \[prompt, setPrompt\] = useState\(initialDraft\);/, "the composer starts from the remembered draft");

// 4. The drawer has no bar of its own; its height toggle rides in the pane bar.
assert.doesNotMatch(drawer, /code-term__drawer-bar|Terminal · this worktree/, "the redundant drawer bar is gone");
assert.match(drawer, /trailingActions=\{[\s\S]{0,400}aria-pressed=\{tall\}/, "the Taller / Shorter toggle is passed into the pane bar");
assert.match(workspace, /\{trailingActions\}\s*<\/div>\s*<\/div>/, "the pane bar renders host actions at its end");

// 5. The rail prints review progress only; the panel header owns the figures.
assert.doesNotMatch(reviewRail, /code-rail__summary-label|code-rail__summary-count|code-rail__summary-stat/, "the rail no longer repeats the worktree label, count and diffstat");

// 3. The viewer header: relative directory, and the directory shrinks first.
assert.match(preview, /absoluteDir\.startsWith\(`\$\{root\}\/`\)[\s\S]{0,80}absoluteDir\.slice\(root\.length \+ 1\)/, "the workbench viewer prints the directory relative to the work root");
assert.match(roomCss, /\.workspace-rail__preview-dir \{\s*flex: 0 100 auto;\s*min-width: 0;/, "the directory gives way before the name and the actions");

// 6. A narrow dock keeps one row of suggestions.
assert.match(roomCss, /@container \(max-width: 35rem\) \{[\s\S]{0,300}\.code-composer__suggestion:nth-child\(n \+ 3\) \{ display: none; \}/, "a narrow dock shows a single row of two suggestions");

// The selected tree row keeps its fill against Button/ghost's unlayered
// transparent background (same cure as .settings-segment), in a sheet the
// tree imports itself rather than the global facade.
const treeSrc = await readFile(new URL("./project-tree.tsx", import.meta.url), "utf8");
const treeCss = await readFile(new URL("../styles/project-tree.css", import.meta.url), "utf8");
assert.match(treeSrc, /import "@\/styles\/project-tree\.css";/, "the tree imports its own stylesheet");
assert.match(treeCss, /\.ui-btn\[data-tree-row\]\[data-selected="true"\][\s\S]{0,120}background: var\(--accent-presence\) !important;/, "the selected row's accent fill beats the ghost background");


// ── Pass 3 fixes (#5729) ─────────────────────────────────────────────────────
const panelSrc = await readFile(new URL("./session-changes-panel.tsx", import.meta.url), "utf8");
const terminalSrc = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");

// A routed open applies once per nonce, however often the host re-renders.
assert.match(workbench, /if \(!openTarget\) return;[\s\S]{0,900}if \(handledOpenRef\.current === openTarget\) return;\s*handledOpenRef\.current = openTarget;/, "the routed-open effect returns early for a target it already handled — by identity, since Date.now() nonces can collide (#5729)");
assert.match(workbench, /useRef<PendingCodeOpen \| null>\(null\)/, "the handled open is remembered as an object, not a nonce");
assert.match(workbench, /setReviewFocus\(\(current\) => \(\{ path: focusPath, nonce: \(current\?\.nonce \?\? 0\) \+ 1 \}\)\)/, "rail focus counts its own requests, so two routed diffs never share a focus nonce");

// A focused terminal hands back exactly the drawer toggle.
assert.match(shortcuts, /export function isCodeShortcutAllowed\(target: EventTarget \| null, action: CodeShortcutId \| null\): boolean \{[\s\S]{0,300}action === "terminal" && typeof el\?\.closest === "function" && Boolean\(el\.closest\("\.xterm"\)\)/, "only the terminal toggle may act from inside xterm");
assert.match(workbench, /const action = codeShortcutForCombo\(keymap, codeComboFromEvent\(event\)\);\s*if \(!isCodeShortcutAllowed\(event\.target, action\)\) return;/, "the desk asks the shared predicate before acting");
assert.match(terminalSrc, /term\.attachCustomKeyEventHandler\(\(e\) => \{\s*if \(handlers\.releaseKey\?\.\(e\)\) return false;/, "xterm skips the host-owned key so it reaches the page");
assert.equal((terminalSrc.match(/releaseKey: \(event\) => releaseKeyRef\.current\?\.\(event\) \?\? false,/g) ?? []).length, 2, "both transports (Tauri and the WebSocket bridge) pass the release key to xterm");
assert.match(drawer, /releaseKey=\{releaseKey\}/, "the drawer passes the release key to its panes");
assert.match(workbench, /toggleHint=\{terminalHint\}\s*releaseKey=\{terminalReleaseKey\}/, "the desk hands the drawer its bound toggle as hint and key test");
assert.doesNotMatch(drawer, /<kbd className="code-term__kbd">⌃`<\/kbd>/, "the drawer hint is no longer hard-coded");
assert.match(workbench, /if \(leavingTerminal\) \{\s*requestAnimationFrame\(\(\) => deskRef\.current\?\.querySelector<HTMLElement>\("\.code-term__bar"\)\?\.focus\(\)\);/, "closing from inside the terminal lands focus on the drawer bar");

// The panel reports a snapshot only after a successful load, and null on unmount.
assert.match(panelSrc, /if \(!loaded \|\| error\) return;\s*onFilesChangeRef\.current\?\.\(files\);/, "no initial [] or failed-load list is reported as a snapshot");
assert.match(panelSrc, /useEffect\(\(\) => \(\) => onFilesChangeRef\.current\?\.\(null\), \[\]\);/, "unmounting clears the reported snapshot");

// Light mode: the viewer takes the page surface; code blocks keep their chrome.
assert.match(roomCss, /:root\[data-mode="light"\] \.code-room__viewer \{ background: var\(--bg-base\); \}/, "the light-mode viewer is not painted with the always-dark code surface");

// Review fixes on #5733.
const changesHook = await readFile(new URL("../lib/use-worktree-changes.ts", import.meta.url), "utf8");
const shortcutsDialog = await readFile(new URL("./code-shortcuts-dialog.tsx", import.meta.url), "utf8");
assert.match(changesHook, /const ticket = ledger\.begin\(opts\);\s*if \(!ticket\) return;/, "requests go through the ledger: one in flight, forced asks queued (worktree-changes-ledger.test.ts)");
assert.match(changesHook, /await fetchChangesSummary\(root, \{ force: !opts\?\.shared \}\);\s*if \(!ledger\.accepts\(ticket\)\) return;/, "an answer from an ended generation is dropped — root alone is not enough after A → B → A");
assert.match(changesHook, /reload = ledger\.end\(ticket\)\.reload;\s*\}\s*if \(reload\) void loadRef\.current\(\);/, "only the current request's end frees the slot and runs a queued reload");
assert.match(changesHook, /const view = snapshot\.root === projectRoot \? snapshot : emptySnapshot\(projectRoot\);/, "until the snapshot is this root's, the hook reports an empty, unloaded summary — no stale first render");
assert.match(changesHook, /useEffect\(\(\) => \{\s*\/\/ A new root is a new generation[^\n]*\n\s*ledger\.newGeneration\(\);/, "every root change starts a new generation");
assert.match(shortcutsDialog, /disabled=\{!combo \|\| isCapturing \|\| isCodeShortcutRequired\(shortcut\.id\)\}/, "the terminal toggle offers no Unbind");
assert.match(shortcutsDialog, /const holder = codeRequiredComboHolder\(keymap, capturing, combo\);\s*if \(holder\) \{/, "rebinding another action to the toggle's key is refused, with a reason");

// ── Pass 3 medium fixes (#5729) ─────────────────────────────────────────────
// The composer's run lives in a per-session store, so a session switch can't
// orphan it, and every outcome is named by one pure rule.
assert.match(composer, /const run = useSyncExternalStore\(\s*composerRuns\.subscribe,/, "the composer reads its run from the per-session store");
assert.doesNotMatch(composer, /useState<Phase>|abortRef/, "no run state is kept in the component");
assert.match(composer, /const outcome = codeComposerOutcome\(\{\s*text: result\.text,\s*error: result\.error,\s*stoppedByReader: composerRuns\.wasStopped\(sessionId, runId\),\s*\}\);/, "the outcome comes from the shared rule, error-aware even with partial text");
assert.match(composer, /const runId = composerRuns\.stop\(sessionId\);\s*if \(!runId\) return;\s*void fetch\("\/api\/chat\/stop"/, "Stop aborts before telling the bridge");
assert.match(composer, /if \(restore && !codeDeskMemory\.read\(sessionId\)\?\.draft\) codeDeskMemory\.write\(sessionId, \{ draft: restore \}\);/, "an unanswered ask goes back to the session's draft even when the composer is gone");

// ── Pass 3 low fixes (#5729) ────────────────────────────────────────────────
const workbenchTree = await readFile(new URL("./code-workbench-tree.tsx", import.meta.url), "utf8");
const rowsSrc = await readFile(new URL("./session-changes-rows.tsx", import.meta.url), "utf8");
// Failure states say what failed and how to recover.
assert.match(workbench, /changesStatus=\{changes\.loaded \? \(changes\.ok \? "ready" : "unavailable"\) : "loading"\}/, "the tree learns whether the changes request failed");
assert.match(workbenchTree, /const filtering = ready && changedOnly && changedCount > 0;/, "a failed or loading summary never filters the tree");
assert.match(workbenchTree, /"Changes unavailable"/, "a failed request is not \"0 changed\"");
assert.match(preview, /Couldn&rsquo;t open \{name\}<\/p>[\s\S]{0,400}onClick=\{\(\) => setReloadNonce\(\(n\) => n \+ 1\)\}/, "a file that fails to open has a headline and a Retry");
assert.match(preview, /\}, \[path, familiarId, reloadNonce, changeVersion\]\);/, "Retry refetches the same path, and a moved change version reads the file again (not a work-root change, #5745)");
assert.match(preview, /onOpenPath\(changedRepoRoot \? `\$\{changedRepoRoot\.replace\(\/\\\/\+\$\/, ""\)\}\/\$\{f\.path\}` : f\.path\)/, "launchpad paths resolve against the git toplevel, not the project");
assert.match(composer, /showSuggestions = [^;]*row\.familiarId/, "no suggestions for a session that cannot send");
assert.match(composer, /No familiar is attached to this session/, "a session with no familiar says why Send is off");
// The shown error is the panel's own or the commit/PR one kept with the draft (#5756).
assert.match(panelSrc, /\{shownError\.action\}: \{shownError\.message\}/, "an action error names its action");
assert.doesNotMatch(panelSrc, /revert: \{actionError/, "no failure is labelled revert unless it was one");
// Shortcuts: narrow steps follow the rail shortcuts, and the tree passes modified arrows.
assert.match(workbench, /if \(action === "changes" \|\| action === "pr"\) \{\s*setRailTab\(action\);\s*onReviewOpenChange\(true\);[^}]*?if \(!fitsSplit\) setStep\("review"\);/, "Changes and PR shortcuts bring the narrow Review step forward");
assert.match(workbench, /else if \(action === "files"\) \{\s*if \(!fitsSplit\) setStep\("files"\);/, "the Files shortcut brings the narrow Files step forward");
assert.match(treeSrc, /if \(e\.altKey \|\| e\.metaKey \|\| e\.ctrlKey\) return;/, "the tree leaves modified arrows to the desk's shortcuts");
// Focus survives the common actions.
assert.match(composer, /readOnly=\{busy\}/, "the composer field stays focusable while a reply streams");
assert.doesNotMatch(composer, /disabled=\{busy\}/, "disabling the focused field dropped focus on the page");
assert.match(rowsSrc, /if \(confirmRevert\) \{\s*cancelRef\.current\?\.focus\(\);\s*\} else if \(returnFocusRef\.current\) \{\s*returnFocusRef\.current = false;\s*revertRef\.current\?\.focus\(\);/, "the revert confirm takes focus and Cancel gives it back");
assert.match(tabs, /onClick=\{\(\) => \{[\s\S]{0,300}const fallback = paths\[index - 1\] \?\? paths\[index \+ 1\] \?\? null;\s*onClose\(path\);\s*if \(fallback\) requestAnimationFrame/, "a clicked close hands focus to the neighbouring tab");
// Rail sizing.
assert.match(workbench, /resizable=\{fitsSplit\}/, "the narrow Review step has no resize controls");
assert.match(reviewRail, /\{resizable \? \(\s*<div\s+role="separator"/, "the grip renders only where resizing changes something");
// ARIA: panels, roving tab stops, stable toggle names.
assert.match(reviewRail, /aria-controls=\{tab === id \? panelId : undefined\}\s*tabIndex=\{tab === id \? 0 : -1\}/, "rail tabs rove and name their panel");
assert.match(reviewRail, /className="code-rail__panel" role="tabpanel" id=\{panelId\} aria-labelledby=\{tabId\(tab\)\}/, "the rail's content is the tabs' panel");
assert.match(tabs, /aria-controls=\{selected \? panelId : undefined\}/, "open-file tabs name the viewer");
assert.match(workbench, /role=\{activeTabIndex >= 0 \? "tabpanel" : undefined\}/, "the viewer is the open-file tabs' panel while there are tabs");
assert.match(workbench, /aria-label=\{`\$\{STEP_LABEL\[id\]\} pane`\}/, "step tabs don't share the code surface's \"Review\" name");
assert.match(workbench, /tabIndex=\{step === id \? 0 : -1\}/, "step tabs rove");
assert.match(rowsSrc, /aria-label=\{`Viewed: \$\{file\.path\}`\}/, "the Viewed switch keeps one name");
assert.match(workspace, /aria-label="Broadcast input"/, "Broadcast keeps one name");
assert.match(reviewRail, /aria-label="Widen the rail"/, "the widen toggle keeps one name");

// #5737 review.
assert.match(preview, /const current = launchpad && launchpad\.root === projectRoot \? launchpad : null;/, "the launchpad shows only the snapshot for the current root");
assert.match(workbench, /column\?\.querySelector<HTMLElement>\('\[role="tree"\]'\) \?\?\s*column\?\.querySelector<HTMLElement>\("\.code-tree__changed-row"\);/, "the Files shortcut looks for the tree before the changed list, and the filter only as a last resort");
assert.match(tabs, /className="focus-ring code-tabs__close"[\s\S]{0,600}tabIndex=\{-1\}/, "close buttons are not tab stops");

// ── Pass 4 high fixes (#5745) ────────────────────────────────────────────────
// 1. The edit lives in the per-path draft store, so leaving a file keeps it.
assert.match(preview, /const draft = useSyncExternalStore\(\s*fileEditDrafts\.subscribe,\s*\(\) => fileEditDrafts\.get\(path\),/, "the viewer reads its edit from the draft store");
assert.match(preview, /const editing = Boolean\(draft\);/, "a file with a draft opens in the editor");
assert.doesNotMatch(preview, /setEditing\(false\)/, "no path change, step switch or remount resets the edit");
assert.match(preview, /onCancel=\{leaveEditor\}/, "Escape leaves the editor for Save instead of discarding");
assert.match(preview, /const cancelEditing = useCallback\(\(\) => \{\s*if \(path\) fileEditDrafts\.discard\(path\);/, "Cancel is the one control that discards");
assert.match(tabs, /dirty\?\.has\(path\) \? \([\s\S]{0,200}data-testid="code-tab-unsaved"[\s\S]{0,200}, unsaved changes/, "a tab with an unsaved edit says so, in sight and in words");
assert.match(workbench, /dirty=\{dirtyPaths\}/, "the workbench hands the dirty set to the tabs");
// 2. A save settles the file it was sent for, and keeps keys typed meanwhile.
assert.match(preview, /const target = pathRef\.current;[\s\S]{0,200}const sending = fileEditDrafts\.startSave\(target\);/, "a save captures the file it is for");
assert.match(preview, /if \(pathRef\.current === target\) \{\s*setFile\(/, "only the file the save was for, if still on screen, takes the saved text");
// 3. A save names its starting version; a changed file is a conflict.
assert.match(preview, /expectedVersion: sending\.baseVersion \?\? undefined/, "a save sends the version its edit started from");
assert.match(preview, /fileEditDrafts\.fail\(\s*target,\s*sending\.id,\s*conflict \? FILE_CHANGED_ON_DISK/, "a refused save keeps the edit and says why");
assert.match(preview, /className="workspace-rail__preview-conflict" role="alert"[\s\S]{0,1200}onClick=\{reloadFromDisk\}[\s\S]{0,400}onClick=\{overwriteDisk\}/, "a conflict offers Reload and Overwrite in its own row");
assert.match(workbench, /changeVersion=\{`\$\{selectedChangeVersion \?\? ""\}\|\$\{viewerRefresh\}`\}/, "the open file is read again when its change version moves, or the inspector changed the branch");

// #5746 review.
const draftsSrc = await readFile(new URL("../lib/file-edit-drafts.ts", import.meta.url), "utf8");
assert.match(draftsSrc, /export const fileEditDrafts = createFileEditDraftStore\(\);[\s\S]{0,1600}window\.addEventListener\("beforeunload"/, "one unload guard per page, installed with the store, so it outlives the viewer");
assert.doesNotMatch(preview, /addEventListener\("beforeunload"/, "no per-viewer unload guard that unmounts with the desk");
assert.match(preview, /title="Discard your changes"[\s\S]{0,200}disabled=\{saving\}/, "Cancel waits for an in-flight save");
assert.match(preview, /fileEditDrafts\.settle\(target, sending\.id,/, "a save settles only the edit it was sent from");

// ── Pass 4 medium fixes (#5745) ──────────────────────────────────────────────
const prPanelSrc = await readFile(new URL("./code-session-pr-panel.tsx", import.meta.url), "utf8");
const pickerSrc = await readFile(new URL("./code-session-picker.tsx", import.meta.url), "utf8");
const readerSrc = await readFile(new URL("./github-pr-reader.tsx", import.meta.url), "utf8");
const inspectorSrc = await readFile(new URL("./code-inspector.tsx", import.meta.url), "utf8");
const codeViewSrc = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
// 4. A cached diff shows only for the file version it was read for.
assert.match(panelSrc, /const diffIsCurrent = useCallback\([\s\S]{0,300}cached\.sig === diffSignature\(file\)/, "a cached diff must match the file's current signature");
assert.match(panelSrc, /if \(expandedPath !== file\.path && !diffIsCurrent\(file\)\) void fetchDiff/, "re-expanding a changed file reads it again");
// 5 and 12. Outbound drafts live in a store keyed by session on the desk.
assert.match(panelSrc, /const outbound = useSyncExternalStore\(\s*changesOutbound\.subscribe,/, "commit and PR drafts come from the outbound store");
assert.match(reviewRail, /draftKey=\{`session:\$\{row\.id\}`\}/, "the desk keys the drafts by session");
// 6. Commit and Create PR are pinned to what was reviewed.
assert.match(panelSrc, /expectedChanges: files\.map\(\(file\) => \(\{ path: file\.path, changeVersion: file\.changeVersion \?\? "" \}\)\)/, "a commit names the list it reviewed");
assert.match(panelSrc, /expectedHead: postCommit\.headOid[\s\S]{0,120}expectedBranch: postCommit\.branch/, "Create PR names the commit and branch");
// 7. The rail merges only on passing checks, pinned to their head.
assert.match(prPanelSrc, /disabled=\{busy != null \|\| mergeBlocked != null\}/, "merge waits for passing checks");
assert.match(prPanelSrc, /"\/api\/github\/merge", \{ repo, number, method: "squash", headSha \}/, "merge is pinned to the checked head");
// The head check comes before busy is set (#5756), so it can't strand the buttons.
assert.match(prPanelSrc, /if \(!headSha\) return;\s*setBusy\([\s\S]{0,120}const result = await post\("\/api\/github\/review", \{[\s\S]{0,200}headSha,\s*\}\);/, "review is always pinned to the checked head");
assert.match(prPanelSrc, /disabled=\{busy != null \|\| headBlocked != null\}/, "Approve waits for the checked head (#5751 review)");
assert.match(panelSrc, /const request = \(diffRequestsRef\.current\.get\(filePath\) \?\? 0\) \+ 1;[\s\S]{0,400}if \(diffRequestsRef\.current\.get\(filePath\) !== request\) return;/, "only the newest diff read for a path lands (#5751 review)");
assert.match(panelSrc, /const filesSig = files\.map\(\(f\) => `\$\{f\.path\}:\$\{diffSignature\(f\)\}`\)\.join\("\|"\);/, "the expanded diff refreshes on the full version stamp");
// 8. Split shells are stopped on close; layouts persist per session.
assert.match(drawer, /if \(paneId !== PRIMARY_TERMINAL_PANE_ID\) stopTerminalThread\(terminalPaneThreadId\(sessionId, paneId\)\);\s*setLayout/, "closing a pane stops its shell before it unmounts");
assert.match(drawer, /writeTerminalLayout\(sessionId, \{ layout, focusedPaneId \}\);/, "the layout is saved per session");
// 9. Saves and inspector actions refresh the desk.
assert.match(preview, /announce\(stillOpen[\s\S]{0,400}window\.dispatchEvent\(new CustomEvent\("cave:changes-refresh"\)\);/, "a save refreshes the changes views");
assert.match(inspectorSrc, /branches\.refresh\(\);[\s\S]{0,300}window\.dispatchEvent\(new CustomEvent\("cave:changes-refresh"\)\);\s*onChanged\?\.\(\);/, "a branch switch refreshes the changes views");
assert.match(codeViewSrc, /onRefresh=\{\(\) => \{\s*onSessionsRefresh\?\.\(\);\s*onTasksRefresh\(\);\s*\}\}/, "the inspector's refresh re-polls the sessions");
// 10. The inspector takes focus.
assert.match(workbench, /const panel = document\.querySelector<HTMLElement>\("\.code-room__inspector"\);[\s\S]{0,300}\(control \?\? panel\)\?\.focus\(\);/, "opening the inspector moves focus into it");
// 11. Picker combobox and focus; full PR view focus.
assert.match(pickerSrc, /role="combobox"\s*aria-expanded=\{open\}\s*aria-controls=\{listboxId\}\s*aria-autocomplete="list"\s*aria-activedescendant=/, "the picker's search field is a combobox");
assert.match(pickerSrc, /if \(\(event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"\) && options\.length > 0\)/, "arrow keys move the active option");
assert.match(pickerSrc, /if \(id !== selected\?\.id\) focusTriggerAfterPickAt = Date\.now\(\);/, "picking another session asks the new desk's picker for focus");
assert.match(readerSrc, /const backRef = useRef<HTMLButtonElement \| null>\(null\);\s*useEffect\(\(\) => \{\s*backRef\.current\?\.focus\(\);/, "the PR reader focuses its Back control on mount");
// 13. The full PR view holds its PR.
assert.match(workbench, /const \[prFull, setPrFull\] = useState<\{ repo: string; number: number \} \| null>\(null\);/, "the full PR view remembers the PR it opened");
assert.match(workbench, /\{prFull \? \(\s*<LazyPrReader repo=\{prFull\.repo\} number=\{prFull\.number\}/, "the reader renders from that PR, not the live row");
// 14. A reveal fetch's answer always lands.
assert.match(treeSrc, /void fetchChildren\(entry\.path, familiarId\)\.then\(\(fetched\) => \{\s*setFetching\(false\);[\s\S]{0,200}setChildren\(\(current\) => current \?\? fetched\);/, "the reveal never drops its answer");

// Pane ids name PTY threads: drawn from the CSPRNG, never Math.random (#5751 review).
const terminalTreeSrc = await readFile(new URL("../lib/code-terminal-tree.ts", import.meta.url), "utf8");
assert.match(terminalTreeSrc, /const PANE_ID_PREFIX = \(\(\) => \{[\s\S]{0,120}globalThis\.crypto\.getRandomValues\(bytes\);/, "the pane-id prefix comes from crypto.getRandomValues");
assert.doesNotMatch(terminalTreeSrc, /Math\.random/, "no Math.random in pane ids");

// ── Pass 4 low fixes (#5745) ─────────────────────────────────────────────────
const workbenchTreeSrc = await readFile(new URL("./code-workbench-tree.tsx", import.meta.url), "utf8");
const rowsSrcLow = await readFile(new URL("./session-changes-rows.tsx", import.meta.url), "utf8");
const pickerLib = await readFile(new URL("../lib/code-session-picker.ts", import.meta.url), "utf8");
const draftsLow = await readFile(new URL("../lib/file-edit-drafts.ts", import.meta.url), "utf8");
const changesHookLow = await readFile(new URL("../lib/use-worktree-changes.ts", import.meta.url), "utf8");
const treeCssLow = await readFile(new URL("../styles/project-tree.css", import.meta.url), "utf8");
// 15. The tree re-reads folders whose files came or went.
assert.match(workbenchTreeSrc, /const STRUCTURAL_STATUSES = new Set<FileStatus>\(\["added", "untracked", "deleted", "renamed"\]\);/, "only adds, deletes and renames change the tree's folders");
assert.match(workbenchTreeSrc, /refreshDirs=\{refreshDirs\}/, "the desk hands the changed folders to the tree");
assert.match(treeSrc, /setRefetchSignal\(\(prev\) => \(\{ dirs: new Set\(refreshDirs\.dirs\), nonce: prev\.nonce \+ 1 \}\)\);/, "the tree re-reads the folders it is told about");
assert.match(workbenchTreeSrc, /lastStructureRef\.current = structureKey;\s*if \(previous === structureKey\) return;/, "the first ready list also refreshes the folders it names (#5753 review)");
// 16. The changes table is a one-stop grid of memoized rows.
assert.match(panelSrc, /role="grid"\s*aria-label="Changed files"/, "the changes table is a grid");
assert.match(panelSrc, /onKeyDown=\{onGridKeyDown\}\s*onFocus=\{onGridFocus\}/, "arrow keys move through it and the last cell keeps the stop");
assert.match(rowsSrcLow, /export const FileRow = memo\(function FileRow\(/, "rows are memoized");
assert.match(rowsSrcLow, /data-grid-row=\{confirmRowKey\(file\.path\)\}/, "the revert confirmation is a grid row (#5753 review)");
assert.match(rowsSrcLow, /data-grid-col=\{0\}\s*tabIndex=\{confirmTab\(0\)\}/, "Cancel joins the grid's one tab stop");
assert.match(rowsSrcLow, /data-grid-col=\{1\}\s*tabIndex=\{confirmTab\(1\)\}/, "Confirm joins the grid's one tab stop");
assert.match(rowsSrcLow, /if \(confirmRevert && col === revertCol\) return -1;/, "the hidden Revert cell gives up its stop while the confirmation is open");
assert.match(panelSrc, /onToggle=\{onToggleRow\}\s*onRevert=\{onRevertRow\}/, "rows get stable callbacks");
assert.match(workbench, /const roomKey = useMemo\(\(\) => codeChangeSnapshotKey\(railFileShapes\), \[railFileShapes\]\);/, "the room key is computed once per list");
assert.match(reviewRail, /if \(!frame\) frame = requestAnimationFrame\(flush\);/, "the rail drag sets one width per frame");
// 17. A match hidden by the group chip is not a miss.
assert.match(pickerLib, /offersCreate: visible\.length === 0 && query\.trim\(\)\.length > 0,/, "create is offered only when nothing matches anywhere");
// 18. Forced colours keep the selections.
assert.match(roomCss, /@media \(forced-colors: active\) \{\s*\[data-code-session-id\]\[aria-current="true"\] \{\s*outline: 2px solid Highlight;/, "the current session keeps an outline in forced colours");
assert.match(treeCssLow, /@media \(forced-colors: active\) \{\s*\.ui-btn\[data-tree-row\]\[data-selected="true"\] \{\s*outline: 2px solid Highlight;/, "the selected file keeps an outline in forced colours");
// 19. The terminal bar wraps.
assert.match(roomCss, /\.code-terminal-workspace__actions \{[^}]*flex-wrap: wrap;/, "the terminal bar's actions wrap on a narrow desk");
// 20. CRLF files are saved as CRLF.
assert.match(draftsLow, /const body = draft\.eol === "\\r\\n" \? draft\.content\.replace\(\/\\n\/g, "\\r\\n"\) : draft\.content;/, "a CRLF file is saved back in CRLF");
assert.match(preview, /content: sending\.body,/, "the viewer sends the file's own line breaks");
// 21. A failed resolve says so.
assert.match(prPanelSrc, /\} catch \(err\) \{\s*setResolveError\(/, "a resolve that never reached GitHub is reported");
// 22. One mount-time read of the change list.
assert.match(changesHookLow, /void load\(\{ shared: true \}\);\s*const onVisible/, "the desk's hook shares its mount read");
assert.match(panelSrc, /useEffect\(\(\) => \{\s*void load\(\{ shared: true \}\);/, "the panel shares its mount read");

// ── Pass 5 high fixes (#5756) ────────────────────────────────────────────────
const changesRouteHigh = await readFile(new URL("../app/api/changes/route.ts", import.meta.url), "utf8");
// 1. A restore rebuilds the snapshot per file and keeps anything changed since.
assert.match(changesRouteHigh, /return restoreCheckpointPatch\(repoRoot, abs, \{/, "restore goes through the per-file module");
assert.match(panelSrc, /const message = checkpointRestoreMessage\(checkpointLabel\(name\), result\);/, "the rail says what came back and what was kept");
// 2. Unsaved drafts outlive a desktop quit, close or update relaunch.
assert.match(draftsSrc, /return desktop \? window\.localStorage : window\.sessionStorage;/, "the desktop app keeps drafts across a restart");
assert.match(draftsSrc, /const persisted = storage \? persistFileEditDrafts\(fileEditDrafts, storage\) : null;/, "the page's drafts are persisted");
assert.match(draftsSrc, /window\.addEventListener\("pagehide", flush\);/, "pending draft writes flush as the page goes");
assert.match(workbench, /withDraftTabs\(codeDeskMemory\.read\(row\.id\)\?\.openFiles \?\? emptyCodeOpenFiles\(\), fileEditDrafts\.dirtyPaths\(\), workRoot\)/, "recovered drafts get tabs");
// 3. Escape always leaves the editor for something that can take focus.
assert.match(preview, /\[saveButtonRef\.current, reloadButtonRef\.current\]\.find\(\(button\) => button && !button\.disabled\) \?\? headerRef\.current/, "Escape goes to Save, Reload, or the viewer");
assert.match(preview, /<header ref=\{headerRef\} tabIndex=\{-1\}/, "the viewer header can take focus from script");

// ── Pass 5 medium fixes (#5756) ──────────────────────────────────────────────
const drawerMed = await readFile(new URL("./code-terminal-drawer.tsx", import.meta.url), "utf8");
const terminalMed = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
const summaryMed = await readFile(new URL("../lib/changes-summary-fetch.ts", import.meta.url), "utf8");
// 4. Overwrite is pinned to the conflict's version.
assert.match(preview, /conflict \? json\.version \?\? null : null,/, "a 409 hands its disk version to the draft");
// 5. Checks keep being read after they settle, with Retry, and after a refusal.
assert.match(prPanelSrc, /usePausablePoll\(reread, SETTLED_CHECKS_POLL_MS, \{ enabled: !pending && state\.phase !== "loading" \}\);/, "settled checks are read again");
assert.match(prPanelSrc, /<ChecksSection state=\{checks\} onRetry=\{recheck\} \/>/, "a failed checks load offers Retry");
// 6. Create PR only with the commit made here; dismissing the result closes the form.
assert.match(panelSrc, /if \(!title \|\| !postCommit[^\n]*\) return;/, "Create PR needs the pinned commit");
assert.match(panelSrc, /onClick=\{\(\) => setOutbound\(\{ postCommit: null, prOpen: false \}\)\}/, "dismissing the commit result closes the PR form");
assert.match(panelSrc, /err instanceof ChangesRequestError && err\.stale[\s\S]{0,400}postCommit: null, prOpen: false/, "a moved branch ends the attempt");
// 9. A terminal starts on the drawer's first open; a mid-start teardown disposes what exists.
assert.match(drawerMed, /const \[started, setStarted\] = useState\(\(\) => open \|\| terminalStarted\(sessionId\)\);/, "no shell until the drawer opens");
assert.match(drawerMed, /\{started \? \(\s*<CodeTerminalWorkspace/, "the workspace mounts once started");
assert.equal((terminalMed.match(/else for \(const dispose of made\.splice\(0\)\.reverse\(\)\) dispose\(\);/g) ?? []).length, 2, "both startup paths dispose a partial start");
// Through the owner's stop, re-run once the shell exists: this view never
// stops a shell on its own (bottom-terminal-ws-bridge.test.ts).
assert.match(terminalMed, /if \(terminalThreadStopped\(threadId\)\) \{\s*stopTerminalThread\(threadId\);\s*return;/, "a desktop shell started for a closed pane is stopped");
assert.match(terminalMed, /if \(terminalThreadStopped\(threadId\)\) \{\s*stopTerminalThread\(threadId\);\s*bridge\.dispose\(\);/, "a browser shell connected for a closed pane is killed");
// 12. In-flight commit and Create PR live in the store.
assert.match(panelSrc, /const committing = outbound\.pending === "commit";/);
assert.match(panelSrc, /const creatingPr = outbound\.pending === "create-pr";/);
// 13. Nothing the desk waits on can hang it.
assert.match(preview, /signal: AbortSignal\.timeout\(SAVE_TIMEOUT_MS\),/, "a save times out");
assert.match(summaryMed, /signal: AbortSignal\.timeout\(CHANGES_SUMMARY_TIMEOUT_MS\)/, "the change list times out");
assert.equal((prPanelSrc.match(/signal: AbortSignal\.timeout\(GITHUB_ACTION_TIMEOUT_MS\),/g) ?? []).length, 2, "review, merge and resolve time out");

// #5775 review: a closed pane's bridge outlives a mid-connect teardown so the
// kill can reach its shell; the checks read times out; one request at a time.
assert.match(terminalMed, /if \(!connected && terminalThreadStopped\(threadId\)\) return;\s*bridge\.dispose\(\);/, "a closed pane's bridge waits for its socket");
assert.match(terminalMed, /if \(terminalThreadStopped\(threadId\)\) \{\s*stopTerminalThread\(threadId\);\s*bridge\.dispose\(\);\s*return;/, "then kills the shell and lets go");
assert.match(prPanelSrc, /cache: "no-store",\s*signal: AbortSignal\.timeout\(CHECKS_TIMEOUT_MS\),/, "the checks read times out into an error with Retry");
assert.match(panelSrc, /const requestPending = outbound\.pending !== null;/);
assert.match(panelSrc, /if \(!message \|\| changesOutbound\.get\(outboundKey\)\.pending\) return;/, "no commit while a request runs");
assert.match(panelSrc, /if \(!title \|\| !postCommit \|\| changesOutbound\.get\(outboundKey\)\.pending\) return;/, "no Create PR while a request runs");

// ── Pass 5 low fixes (#5756) ─────────────────────────────────────────────────
const pickerLow5 = await readFile(new URL("./code-session-picker.tsx", import.meta.url), "utf8");
const treeLow5 = await readFile(new URL("./project-tree.tsx", import.meta.url), "utf8");
// 15. A forced load mid-flight is queued, not dropped.
assert.match(panelSrc, /if \(opts\?\.shared\) return;\s*queuedLoadRef\.current = true;/, "a forced load arriving mid-flight is queued");
// …and waits for the run it queued (#5781).
assert.match(panelSrc, /return queuedRunRef\.current\.promise;/);
assert.match(panelSrc, /void loadAgainRef\.current\(\)\.finally\(\(\) => queued\?\.resolve\(\)\);/);
// 16. Focus has somewhere to go after a confirmed revert.
// It waits for the commit that re-enables Revert, not a frame (#5779).
assert.match(panelSrc, /setRevertingPath\(null\);\s*setRevertFocus\(\{ path: file\.path, index: Math\.max\(0, index\) \}\);/);
assert.match(panelSrc, /useEffect\(\(\) => \{\s*if \(revertFocus\) restoreFocusAfterRevert\(revertFocus\.path, revertFocus\.index\);\s*\}, \[revertFocus, restoreFocusAfterRevert\]\);/);
assert.doesNotMatch(panelSrc, /requestAnimationFrame\(\(\) => restoreFocusAfterRevert/, "no frame racing the commit");
// 17. The picker's highlight is a session, not a position.
assert.match(pickerLow5, /const active = options\.find\(\(option\) => option\.id === activeId\) \?\? options\[0\] \?\? null;/);
// 23. A newer read of a folder supersedes an older one; nothing else cancels it.
assert.match(treeLow5, /const id = \+\+refetchIdRef\.current;[\s\S]{0,200}if \(id !== refetchIdRef\.current\) return;\s*setFetching\(false\);/, "the folder's newest read always clears its spinner");
assert.doesNotMatch(treeLow5, /After a move, refetch[\s\S]{0,800}return \(\) => \{ cancelled = true; \};/, "an unrelated signal no longer cancels a folder's read");
// 23. A broken connection may still have posted the review.
assert.match(prPanelSrc, /if \(err instanceof TypeError\) return "The connection broke before GitHub answered\. Check the pull request before trying again\.";/);
// 23. Placeholders show intent, not the label or a state.
assert.match(panelSrc, /placeholder="Describe the change…"/);
assert.match(panelSrc, /aria-label="Pull request description \(optional\)"/);

// #5778 review: no save path reaches a missing file, no conflict row beside
// it, and focus is restored only when it fell to the page.
assert.match(preview, /if \(!target \|\| missingOnDiskRef\.current\) return;/, "saveEdit refuses a missing file, whichever path calls it");
assert.match(preview, /\{draft\?\.conflict && !missingOnDisk \? \(/, "no Reload/Overwrite for a file that's gone");
assert.match(panelSrc, /if \(!panel \|\| \(active && active !== document\.body\)\) return;/, "focus is restored only from the page");

// ── Pass 6 low fixes (#5781) ─────────────────────────────────────────────────
{
  const terminal = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
  const drawerLow6 = await readFile(new URL("./code-terminal-drawer.tsx", import.meta.url), "utf8");
  const prPanel = await readFile(new URL("./code-session-pr-panel.tsx", import.meta.url), "utf8");
  const inspector = await readFile(new URL("./code-inspector.tsx", import.meta.url), "utf8");
  const roomCss = await readFile(new URL("../styles/globals/surface-code-room.css", import.meta.url), "utf8");
  // 32. A terminal that starts takes focus only from nothing or its own host.
  assert.match(terminal, /function mayTakeStartupFocus\(wrap: HTMLElement \| null\): boolean \{[\s\S]{0,300}current === document\.body\) return true;[\s\S]{0,200}closest\("\[data-terminal-host\]"\)/);
  assert.equal(terminal.match(/if \(mayTakeStartupFocus\(wrap\)\) term\.focus\(\);/g)?.length, 2, "both transports start by the rule");
  assert.match(terminal, /if \(first && !mayTakeStartupFocus\(wrapRef\.current\)\) return;/, "the first activation is a start too");
  assert.match(drawerLow6, /className="code-term" data-open=\{open \? "true" : undefined\} data-terminal-host=""/);
  // 36. State in words beside the colour.
  assert.match(prPanel, /<span className="sr-only">\{`, \$\{\(run\.conclusion \?\? run\.status\)\.replace\(\/_\/g, " "\)\}`\}<\/span>/, "a check run says pass or fail");
  assert.match(prPanel, /title=\{step\.detail\}>[\s\S]{0,200}<span className="sr-only">\{`, \$\{step\.detail\}`\}<\/span>/, "a stage step says its state");
  assert.match(inspector, /aria-current=\{b\.current \? "true" : undefined\}/);
  assert.match(roomCss, /@media \(forced-colors: active\) \{\s*\.code-picker__row\[data-active="true"\] \{ outline: 2px solid Highlight;/);
}

console.log("code-desk-overhaul pins ok");

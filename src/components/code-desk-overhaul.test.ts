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
  /<CodeOpenFileTabs[\s\S]*?onClose=\{closeTab\}[\s\S]*?\/>\s*<RailFilePreview/,
  "the tab strip renders directly above the file viewer",
);
assert.match(workbench, /setOpenFiles\(\(current\) => openCodeFile\(current, absolute\)\)/, "opening a path goes through openCodeFile");
assert.match(workbench, /setOpenFiles\(memory\?\.openFiles \?\? emptyCodeOpenFiles\(\)\);/, "tabs are per session — restored from that session's memory, or empty");
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
assert.match(tabs, /aria-label=\{`Close \$\{label\}`\}/, "each close control names its file");
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
assert.match(composer, /role="status" data-phase=\{phase\.kind\}[\s\S]{0,400}\{CODE_COMPOSER_STATUS\[phase\.kind\]\}/, "the reply card carries a status word");
assert.match(composer, /placeholder=\{busy \? "The familiar is working…" : "Ask for follow-up changes…"\}/, "the placeholder is unchanged");
assert.match(
  workbench,
  /<CodeComposer[\s\S]{0,400}contextPath=\{selectedRelative\}[\s\S]{0,200}hasChanges=\{[^}]*\}[\s\S]{0,100}hasPr=\{Boolean\(pr\)\}/,
  "the workbench hands the composer the open file and the session's state",
);

// 5. The terminal drawer: resizable, clamped to the room, remembered.
assert.match(drawer, /role="separator"[\s\S]{0,200}aria-orientation="horizontal"[\s\S]{0,700}onKeyDown=\{onGripKeyDown\}/, "the grip is keyboard-operable");
assert.match(drawer, /setHeightPx\(readCodeTerminalHeight\(safeStorage\(\)\)\);/, "the remembered height is read after mount");
assert.match(drawer, /setHeightPx\(\(current\) => clampCodeTerminalHeight\(current, roomHeightPx\)\);/, "a shrinking room re-clamps the drawer");
assert.match(drawer, /writeCodeTerminalHeight\(safeStorage\(\), clamped\);/, "commits persist the clamped height");
assert.match(drawer, /aria-valuemin=\{clampCodeTerminalHeight\(CODE_TERMINAL_MIN_HEIGHT_PX, roomHeightPx\)\}/, "the accessible minimum respects an undersized room's ceiling");
assert.match(drawer, /visible=\{open\}/, "the workspace still hides via its keepalive prop, never by unmounting");
assert.match(workbench, /const bodyHeight = useMeasuredHeight\(roomRef\);[\s\S]*bodyHeightPx=\{bodyHeight\}/, "the drawer is bounded by the column body it shares space with, not the whole desk");
assert.match(drawer, /const roomHeightPx = bodyHeightPx == null \? null : bodyHeightPx \+ \(open \? heightPx : 0\);/, "the ceiling is 70% of the body plus the drawer — the region they share");
assert.match(roomCss, /\.code-room__body \{[^}]*overflow: hidden;/, "the columns clip to their box, so nothing paints over the drawer");

// 6. Review progress: viewed state is the workbench's, the rail is controlled.
assert.match(workbench, /const \[viewed, setViewed\] = useState<CodeRailViewedState>\(\(\) => codeDeskMemory\.read\(row\.id\)\?\.viewed \?\? \{\}\);/, "the workbench owns per-file viewed state, seeded from the session's memory");
assert.match(workbench, /setViewed\(memory\?\.viewed \?\? \{\}\);[\s\S]{0,80}setReviewFocus\(null\);/, "review state is per session — another session's ticks never carry over");
assert.doesNotMatch(workbench, /railFiles/, "every progress figure — count, next file, completion tint — reads the room's live changes summary");
assert.doesNotMatch(reviewRail, /useState<CodeRailViewedState>/, "the rail no longer keeps its own viewed state");
assert.match(reviewRail, /viewed=\{viewed\}\s*onToggleViewed=\{onToggleViewed\}/, "the changes panel is wired to the lifted state");
assert.doesNotMatch(reviewRail, /onFilesChange/, "the rail no longer reports a second file list up — the workbench's summary is the one source");
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
assert.match(workbench, /if \(memoryOwnerRef\.current !== row\.id\) return;\s*codeDeskMemory\.write\(row\.id, \{ openFiles, viewed \}\);/, "writes are skipped while state still belongs to the previous session");
assert.match(workbench, /memoryOwnerRef\.current = row\.id;\s*\}, \[row\.id\]\);/, "ownership moves only after the restore lands");
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

console.log("code-desk-overhaul pins ok");

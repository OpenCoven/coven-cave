"use client";

/**
 * CodeWorkbench — the Coding Desk's per-session workbench (cave-k0ua,
 * recomposed for cave-98o51, rebuilt from the design frame for cave-0rcku).
 *
 * The `Cody Code Reading v2` frame's shape:
 *
 *   header            session picker · branch · diffstat · PR · inspector
 *   [source-context]  the handoff card, when you arrived from a chat block
 *   tree | viewer | review rail
 *   terminal bar      always present, expands into a drawer over the room
 *   composer
 *
 * What changed from the previous three-zone room, and why. The terminal used to
 * be the centre column, which was the right answer to "don't hide the shell"
 * but the wrong one for a surface whose name is *reading*: two columns of the
 * room went to a shell and a dock, and the source itself never got a column at
 * all. The frame keeps the same commitment — the shell is permanently present,
 * never a tab — and pays for it in height instead of width. The drawer never
 * unmounts (`CodeTerminalDrawer`), so the `cave.rail.<id>` PTY started from
 * Chat is still the same shell here, scrollback intact.
 *
 * Nothing was dropped in the move. The old dock's Inspector is the header's
 * popover; its GitHub and Browser tabs are the surface's own top-level tabs and
 * the Browser surface, both of which already existed and neither of which ever
 * wanted a sidebar-width column.
 *
 * The #5705 overhaul, in the order you meet it top to bottom:
 *   - the header is an identity strip — activity pill, branch, PR state,
 *     diffstat and review progress as chips whose meaning is a word;
 *   - the viewer keeps a strip of open-file tabs (`code-open-files.ts`), so a
 *     second file no longer erases the first;
 *   - the per-file *viewed* state lives here, not in the rail, so the header
 *     can print progress while the rail is a spine and "Next unviewed" can open
 *     the file in the viewer while focusing its diff in the rail;
 *   - the terminal drawer is resizable and remembers its height;
 *   - the composer knows the open file and the session's state.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "@/styles/globals/surface-code-room.css";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { relativeTime } from "@/lib/relative-time";
import { CodeComposer } from "@/components/code-composer";
import { CodeOpenFileTabs, codeOpenFileTabId } from "@/components/code-open-file-tabs";
import { codeTablistKeyTarget } from "@/lib/code-tablist-keys";
import { CodeReviewRail } from "@/components/code-review-rail";
import { CodeSessionPicker } from "@/components/code-session-picker";
import { CodeShortcutsDialog } from "@/components/code-shortcuts-dialog";
import { CodeTerminalDrawer } from "@/components/code-terminal-drawer";
import { CodeWorkbenchTree, STATUS_LETTER, absolutePath } from "@/components/code-workbench-tree";
import dynamic from "next/dynamic";
import { CodeInspector } from "@/components/code-inspector";
import { RailFilePreview } from "@/components/rail-file-preview";
import { useAnnouncer } from "@/components/ui/live-region";
import { useIsMobile } from "@/lib/use-viewport";
import { useMeasuredHeight, useMeasuredWidth } from "@/lib/use-measured-width";
import {
  CODE_STEP_ANNOUNCEMENT,
  CODE_WORKBENCH_STEPS,
  codeRailTabForWorkbenchTab,
  codeSessionActivity,
  codeSessionWorkRoot,
  codeWorkbenchFitsSplit,
  resolveCodeWorkbenchPanels,
  type CodeWorkbenchStep,
  type CodeWorkbenchTab,
} from "@/lib/code-surface";
import {
  CODE_RAIL_DEFAULT_WIDTH_PX,
  clampCodeRailWidth,
  countCodeRailViewed,
  nextUnviewedCodeFile,
  toggleCodeRailViewed,
  type CodeRailTab,
  type CodeRailViewedState,
  codeRailShapeOf,
  codeChangeSnapshotKey,
} from "@/lib/code-side-rail";
import { codeDeskIdentity, codeDeskReviewProgress } from "@/lib/code-desk-header";
import {
  closeCodeFile,
  cycleCodeFile,
  emptyCodeOpenFiles,
  openCodeFile,
  type CodeOpenFiles,
} from "@/lib/code-open-files";
import type { ChangedFile } from "@/lib/session-changes-api";
import { codeDeskMemory } from "@/lib/code-desk-memory";
import {
  CODE_SHORTCUT_STORAGE_KEY,
  codeComboFromEvent,
  codeShortcutForCombo,
  isCodeShortcutAllowed,
  codeComboChips,
  defaultCodeKeymap,
  mergeCodeKeymap,
  type CodeShortcutId,
} from "@/lib/code-shortcuts";
import { useWorktreeChanges } from "@/lib/use-worktree-changes";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
import type { CodeQueueMode, CodeReviewQueue } from "@/lib/code-review-queue";
import type { SessionRow } from "@/lib/types";

// The reader pulls a markdown renderer and a diff highlighter; the room opens
// far more often than the full PR view, so it stays out of the first chunk.
const LazyPrReader = dynamic(
  () => import("@/components/github-pr-reader").then((m) => m.GitHubPrReader),
  { ssr: false },
);

const STEP_LABEL: Record<CodeWorkbenchStep, string> = {
  files: "Files",
  source: "Source",
  review: "Review",
};

export function CodeWorkbench({
  row,
  queue,
  queueMode,
  reviewOpen,
  terminalOpen,
  initialTab,
  openTarget,
  onQueueModeChange,
  onReviewOpenChange,
  onTerminalOpenChange,
  onSelectSession,
  onNewSession,
  onJumpToSession,
  onRefresh,
  onInitialTabHandled,
}: {
  row: SessionRow;
  /** The shared precomputed queue, for the header picker. */
  queue: CodeReviewQueue;
  queueMode: CodeQueueMode;
  reviewOpen?: boolean;
  terminalOpen?: boolean;
  /** Deep-linked review tab (?wtab=), mapped through the rail vocabulary. */
  initialTab?: CodeWorkbenchTab;
  /** A routed file/diff open (cave-ohcj): lands on the file or the review rail
   *  with that path focused. `nonce` re-triggers the jump for a repeat path. */
  openTarget?: PendingCodeOpen;
  onQueueModeChange: (mode: CodeQueueMode) => void;
  onReviewOpenChange: (open: boolean) => void;
  onTerminalOpenChange: (open: boolean) => void;
  onSelectSession?: (sessionId: string) => void;
  /** Receives the picker's unmatched query, which seeds the kickoff prompt. */
  onNewSession?: (seed: string) => void;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  /** Re-poll the enriched session list (branch/worktree chips) after inspector mutations. */
  onRefresh?: () => void;
  onInitialTabHandled?: () => void;
}) {
  const workRoot = codeSessionWorkRoot(row);
  const pr = row.pullRequest;
  const prRepo = pr?.repo ?? null;
  const prNumber = pr?.number ?? null;
  const running = codeSessionActivity(row) === "running";
  const handledOpenRef = useRef<PendingCodeOpen | null>(null);
  const handledInitialTabRef = useRef<CodeWorkbenchTab | null>(null);

  // ── Layout state ───────────────────────────────────────────────────────────
  // Measured against the workbench's OWN body, not the viewport: this renders
  // inside the role-surface host beside the app sidebar and can be placed in a
  // split, so the viewport says nothing useful about the width the three
  // columns actually got. `useIsMobile` only stands in for the frames before
  // the first measurement lands.
  const roomRef = useRef<HTMLDivElement | null>(null);
  const measuredWidth = useMeasuredWidth(roomRef);
  const deskRef = useRef<HTMLDivElement | null>(null);
  // The column body's height bounds the terminal drawer (#5718). The drawer
  // shares its space only with the columns — measuring the whole desk counted
  // the header and the composer too, and let the drawer leave the columns so
  // little height that the review rail painted over the drawer's pane bar.
  const bodyHeight = useMeasuredHeight(roomRef);
  const isMobile = useIsMobile();
  const roomWidth = measuredWidth ?? (isMobile ? 390 : 1200);

  const [railTab, setRailTab] = useState<CodeRailTab>(() =>
    codeRailTabForWorkbenchTab(initialTab) ?? "changes",
  );
  const [railWidth, setRailWidth] = useState(CODE_RAIL_DEFAULT_WIDTH_PX);
  const [treeChangedOnly, setTreeChangedOnly] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // The frame's `prFull`: the reader replaces the columns, and the room keeps
  // your file, your rail width and your step for the trip back.
  const [prFull, setPrFull] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const inspectorAnchor = useRef<HTMLButtonElement | null>(null);

  // Keep the rail inside the room when the room itself is resized.
  useEffect(() => {
    setRailWidth((width) => clampCodeRailWidth(width, roomWidth));
  }, [roomWidth]);

  // ── Narrow rooms drill in (cave-k3a9u, kept) ───────────────────────────────
  // Measured against the room's own box, never the viewport: the Room renders
  // inside the role-surface host beside the app sidebar and can be placed in a
  // split, so viewport width systematically overstates what it actually got.
  // Three crushed columns is the failure this prevents.
  const fitsSplit = codeWorkbenchFitsSplit(measuredWidth, isMobile);
  const initialTabNeedsMeasuredLayout = initialTab === "files" && measuredWidth === null && typeof ResizeObserver !== "undefined" && !isMobile;
  const [step, setStep] = useState<CodeWorkbenchStep>("source");
  const { announce } = useAnnouncer();
  // Tab ↔ panel wiring (#5729): the steps, the open files and the viewer each
  // need ids the other side can point at.
  const deskId = useId();
  const stepTabId = (id: CodeWorkbenchStep) => `${deskId}-step-${id}`;
  const stepPanelId = (id: CodeWorkbenchStep) => `${deskId}-step-panel-${id}`;
  const stepPanel = (id: CodeWorkbenchStep) =>
    fitsSplit ? {} : { id: stepPanelId(id), role: "tabpanel" as const, "aria-labelledby": stepTabId(id) };
  const fileTabPrefix = `${deskId}-file`;
  const viewerPanelId = `${deskId}-viewer`;
  const stepTabRefs = useRef(new Map<CodeWorkbenchStep, HTMLButtonElement>());
  const announcedStepRef = useRef<CodeWorkbenchStep | null>(null);
  // Announced from an effect, never from inside a setState updater — React
  // re-invokes updaters while rendering, and writing to the live region there
  // is a render-phase setState on another component.
  useEffect(() => {
    if (announcedStepRef.current === step) return;
    announcedStepRef.current = step;
    // Silent while all three columns are showing — the step means nothing then.
    if (fitsSplit) return;
    announce(CODE_STEP_ANNOUNCEMENT[step]);
  }, [announce, fitsSplit, step]);

  // ── Selected file ──────────────────────────────────────────────────────────
  // Tabs, viewed ticks and the draft are remembered per session (#5718):
  // CodeView remounts this workbench for every session it shows, so without
  // the memory a round trip to another session threw the reader's work away.
  const [selectedPath, setSelectedPath] = useState<string | null>(
    () => codeDeskMemory.read(row.id)?.openFiles.active ?? null,
  );
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [rangeLabel, setRangeLabel] = useState<string | null>(null);
  // Open-file tabs (#5705): per session, bounded, the viewer's own history.
  const [openFiles, setOpenFiles] = useState<CodeOpenFiles>(
    () => codeDeskMemory.read(row.id)?.openFiles ?? emptyCodeOpenFiles(),
  );
  // Review state is per session: carrying one session's ticks into another
  // would certify files nobody looked at. Restoring a session's OWN ticks is
  // safe — each is recorded against the file's diffstat, so a file that
  // changed while you were away reads as unviewed again.
  const [viewed, setViewed] = useState<CodeRailViewedState>(() => codeDeskMemory.read(row.id)?.viewed ?? {});
  const [reviewFocus, setReviewFocus] = useState<{ path: string; nonce: number } | null>(null);
  // One workbench per session: CodeView keys this component by session id,
  // so `row.id` is fixed for the life of a mount and the state above is seeded
  // from that session's memory exactly once (#5729). A `[row.id]` effect that
  // re-applied the memory used to sit here; it never ran for a real switch,
  // and under StrictMode's mount, unmount, mount it reset the rail focus a
  // routed diff open had just set, so the handed-off file arrived collapsed.
  useEffect(() => {
    codeDeskMemory.write(row.id, { openFiles, viewed });
  }, [openFiles, row.id, viewed]);

  const panels = resolveCodeWorkbenchPanels({
    row,
    reviewOpen,
    terminalOpen,
    initialTab:
      handledInitialTabRef.current === initialTab ? undefined : initialTab,
    openTarget:
      openTarget && handledOpenRef.current === openTarget ? undefined : openTarget,
  });

  const openPath = useCallback(
    (path: string) => {
      const absolute = path.startsWith("/") ? path : absolutePath(workRoot, path);
      setSelectedPath(absolute);
      setFocusLine(null);
      setRangeLabel(null);
      setOpenFiles((current) => openCodeFile(current, absolute));
    },
    [workRoot],
  );

  // Switching tabs keeps the strip; a routed line/range belongs to the open
  // that carried it, so leaving that tab drops it.
  const selectTab = useCallback((path: string) => {
    setOpenFiles((current) => openCodeFile(current, path));
    setSelectedPath(path);
    setFocusLine(null);
    setRangeLabel(null);
  }, []);
  const closeTab = useCallback((path: string) => {
    setOpenFiles((current) => {
      const next = closeCodeFile(current, path);
      if (next === current) return current;
      if (current.active === path) {
        setSelectedPath(next.active);
        setFocusLine(null);
        setRangeLabel(null);
      }
      return next;
    });
  }, []);
  const cycleTab = useCallback((direction: 1 | -1) => {
    setOpenFiles((current) => {
      const next = cycleCodeFile(current, direction);
      if (next !== current && next.active) {
        setSelectedPath(next.active);
        setFocusLine(null);
        setRangeLabel(null);
      }
      return next;
    });
  }, []);

  // A routed open outranks whatever the room was showing: a diff jump selects
  // the review rail, a file open selects the file — and either one reopens a
  // closed rail (and drills the narrow room to the right step) so the routed
  // target is actually visible rather than silently correct behind something.
  useEffect(() => {
    if (initialTabNeedsMeasuredLayout) return;
    if (!initialTab) return;
    if (handledInitialTabRef.current === initialTab) return;
    handledInitialTabRef.current = initialTab;
    const nextRailTab = codeRailTabForWorkbenchTab(initialTab);
    if (initialTab === "terminal") onTerminalOpenChange(true);
    if (initialTab === "files" && !fitsSplit) setStep("files");
    if (nextRailTab) {
      setRailTab(nextRailTab);
      onReviewOpenChange(true);
      setStep("review");
    }
    onInitialTabHandled?.();
  }, [fitsSplit, initialTab, initialTabNeedsMeasuredLayout, onInitialTabHandled, onReviewOpenChange, onTerminalOpenChange]);

  useEffect(() => {
    if (!openTarget) return;
    // Once per routed open (#5729). CodeView keeps the target set until the
    // reader switches session and passes `onReviewOpenChange` as a fresh arrow
    // each render, so without this every re-render (a sessions poll, hiding
    // the rail) replayed the open: the rail could not be hidden, and the
    // viewer jumped back to the routed file over whatever was open.
    // Tracked by identity, not by nonce: producers mint nonces from
    // Date.now(), so two opens in one millisecond could share one.
    if (handledOpenRef.current === openTarget) return;
    handledOpenRef.current = openTarget;
    if (openTarget.kind === "changes") {
      setRailTab("changes");
      onReviewOpenChange(true);
      setStep("review");
      const focusPath = openTarget.path;
      if (focusPath) setReviewFocus((current) => ({ path: focusPath, nonce: (current?.nonce ?? 0) + 1 }));
    } else if (openTarget.path) {
      openPath(openTarget.path);
      setFocusLine(openTarget.line ?? null);
      setStep("source");
    }
    setRangeLabel(openTarget.origin?.selectionLabel ?? null);
  }, [onReviewOpenChange, openPath, openTarget]);

  const changes = useWorktreeChanges(workRoot, running);
  // The tree and the tabs resolve change paths against the same base.
  const changesBase = changes.repoRoot || workRoot;
  const tabStatus = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of changes.files) map.set(absolutePath(changesBase, file.path), STATUS_LETTER[file.status] ?? "M");
    return map;
  }, [changes.files, changesBase]);
  const activeTabIndex = openFiles.active ? openFiles.paths.indexOf(openFiles.active) : -1;
  const selectedRelative = useMemo(() => {
    if (!selectedPath) return null;
    const base = changesBase.replace(/\/$/, "");
    return selectedPath.startsWith(`${base}/`) ? selectedPath.slice(base.length + 1) : selectedPath;
  }, [changesBase, selectedPath]);

  // ── Review progress (#5705) ────────────────────────────────────────────────
  const toggleViewed = useCallback((file: ChangedFile) => {
    setViewed((current) => toggleCodeRailViewed(current, codeRailShapeOf(file)));
  }, []);
  const railFileShapes = useMemo(
    () => changes.files.map(codeRailShapeOf),
    [changes.files],
  );
  const viewedCount = countCodeRailViewed(viewed, railFileShapes);

  // ── One snapshot (#5720 review, reworked for #5729) ────────────────────────
  // The changes panel keeps its own fetch — it owns the commit, revert and
  // error states — and the panel is where the reader's own actions land
  // (revert, commit, Refresh). So the panel leads: each time ITS snapshot
  // changes and disagrees with the room's, the room refetches once. Nothing
  // else triggers it, which bounds the work by the panel's own updates.
  // The first version refetched BOTH on any disagreement: the panel's initial
  // `[]` forced a round on every mount, a list left behind by an unmounted
  // panel forced one on every room update, and a worktree under continuous
  // writes kept producing fresh disagreements.
  const [panelFiles, setPanelFiles] = useState<ChangedFile[] | null>(null);
  const panelKey = useMemo(
    () => (panelFiles ? codeChangeSnapshotKey(panelFiles.map(codeRailShapeOf)) : null),
    [panelFiles],
  );
  const roomKeyRef = useRef("");
  roomKeyRef.current = codeChangeSnapshotKey(railFileShapes);
  const refreshRoomRef = useRef(changes.refresh);
  refreshRoomRef.current = changes.refresh;
  useEffect(() => {
    if (panelKey === null || panelKey === roomKeyRef.current) return;
    refreshRoomRef.current();
  }, [panelKey]);
  const reviewProgress = codeDeskReviewProgress(viewedCount, changes.files.length);
  const nextUnviewedShape = nextUnviewedCodeFile(railFileShapes, viewed, selectedRelative);
  const nextUnviewed = nextUnviewedShape ? changes.files.find((file) => file.path === nextUnviewedShape.path) ?? null : null;
  const openNextUnviewed = useCallback(() => {
    if (!nextUnviewed) return;
    openPath(absolutePath(changesBase, nextUnviewed.path));
    setFocusLine(null);
    setRangeLabel(null);
    setRailTab("changes");
    onReviewOpenChange(true);
    setReviewFocus((current) => ({ path: nextUnviewed.path, nonce: (current?.nonce ?? 0) + 1 }));
    if (!fitsSplit) setStep("source");
    announce(`Opened ${nextUnviewed.path}.`);
  }, [announce, changesBase, fitsSplit, nextUnviewed, onReviewOpenChange, openPath]);

  // ── Shortcuts ──────────────────────────────────────────────────────────────
  const [keymap, setKeymap] = useState<Record<CodeShortcutId, string>>(defaultCodeKeymap);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CODE_SHORTCUT_STORAGE_KEY);
      if (raw) setKeymap(mergeCodeKeymap(JSON.parse(raw)));
    } catch {
      /* a corrupt keymap falls back to defaults rather than blocking the room */
    }
  }, []);
  // The terminal toggle as the desk binds it: the drawer bar's hint and the
  // key a focused terminal hands back (#5729). Read through a ref so the
  // terminal never needs re-creating when the binding changes.
  const [apple, setApple] = useState(false);
  useEffect(() => {
    setApple(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
  }, []);
  const terminalHint = useMemo(() => codeComboChips(keymap.terminal, apple), [apple, keymap.terminal]);
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  const terminalReleaseKey = useCallback(
    (event: KeyboardEvent) =>
      event.type === "keydown" && codeShortcutForCombo(keymapRef.current, codeComboFromEvent(event)) === "terminal",
    [],
  );
  const updateKeymap = useCallback((next: Record<CodeShortcutId, string>) => {
    setKeymap(next);
    try {
      window.localStorage.setItem(CODE_SHORTCUT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — the binding still applies for this session */
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Never steal a keystroke from a field — the composer, the picker's
      // filter, the editor — nor from a focused TERMINAL pane, where Ctrl+P
      // and Ctrl+C belong to the shell. The one exception is the drawer's own
      // toggle, which a focused terminal hands back (#5729); both rules live
      // in one predicate so the room and the terminal cannot disagree.
      const action = codeShortcutForCombo(keymap, codeComboFromEvent(event));
      if (!isCodeShortcutAllowed(event.target, action)) return;
      event.preventDefault();
      if (action === "help") setKeysOpen((open) => !open);
      else if (action === "terminal") {
        const leavingTerminal =
          panels.terminalOpen &&
          event.target instanceof Element &&
          Boolean(event.target.closest(".code-term__drawer"));
        onTerminalOpenChange(!panels.terminalOpen);
        // Closing hides the drawer (inert), which would drop focus on the
        // page; land it on the bar that reopens the drawer instead.
        if (leavingTerminal) {
          requestAnimationFrame(() => deskRef.current?.querySelector<HTMLElement>(".code-term__bar")?.focus());
        }
      }
      else if (action === "changes" || action === "pr") {
        setRailTab(action);
        onReviewOpenChange(true);
        // In the narrow layout the rail is a step; switching tab behind a
        // hidden step did nothing visible (#5729).
        if (!fitsSplit) setStep("review");
      } else if (action === "files") {
        if (!fitsSplit) setStep("files");
        // The tree, or the changed-only list when that filter is on. Looked up
        // one at a time: a combined selector returns the first match in
        // document order, which is always the filter button above both
        // (#5737 review). The tree lists itself only after its first load, and
        // on a narrow room it mounts with this step, so give it a few frames
        // before settling on the filter.
        let frames = 0;
        const focusTree = () => {
          const column = roomRef.current?.querySelector<HTMLElement>(".code-room__tree");
          const target =
            column?.querySelector<HTMLElement>('[role="tree"]') ??
            column?.querySelector<HTMLElement>(".code-tree__changed-row");
          if (target) target.focus();
          else if (++frames < 30) requestAnimationFrame(focusTree);
          else column?.querySelector<HTMLElement>(".code-tree__filter")?.focus();
        };
        requestAnimationFrame(focusTree);
      } else if (action === "outline") {
        roomRef.current
          ?.querySelector<HTMLElement>('.workspace-rail__preview-action[aria-expanded]')
          ?.click();
      } else if (action === "prompt") {
        deskRef.current?.querySelector<HTMLTextAreaElement>(".code-composer textarea")?.focus();
      } else if (action === "picker") {
        deskRef.current?.querySelector<HTMLElement>(".code-picker__trigger")?.click();
      } else if (action === "next-file") {
        cycleTab(1);
      } else if (action === "previous-file") {
        cycleTab(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycleTab, fitsSplit, keymap, onReviewOpenChange, onTerminalOpenChange, panels.terminalOpen]);

  const changedFiles = useMemo(() => changes.files, [changes.files]);
  const identity = codeDeskIdentity(row, changes);

  return (
    <div className="code-room" data-testid="code-workbench" ref={deskRef}>
      <div className="code-room__header" data-testid="code-workbench-header">
        <div className="code-room__identity">
          <div className="code-room__identity-row">
            <CodeSessionPicker
              queue={queue}
              mode={queueMode}
              selected={row}
              onModeChange={onQueueModeChange}
              onSelect={(id) => onSelectSession?.(id)}
              onCreate={onNewSession}
            />
            {/* Activity is a WORD beside the dot, never the dot alone. */}
            <span
              className="code-room__pill"
              data-tone={identity.activity.tone}
              data-activity={identity.activity.kind}
              data-testid="code-desk-activity"
            >
              <span className="code-room__pill-dot" aria-hidden="true" />
              {identity.activity.word}
            </span>
          </div>
          <div className="code-room__chips" data-testid="code-desk-chips">
            {identity.branch ? (
              <span className="code-room__chip" title={workRoot} data-testid="code-desk-branch">
                <Icon name="ph:git-branch" width={11} height={11} aria-hidden />
                <span className="code-room__chip-value">{identity.branch.name}</span>
                {identity.branch.worktree ? <span className="code-room__chip-note">worktree</span> : null}
              </span>
            ) : null}
            {identity.pr ? (
              identity.pr.url ? (
                <a
                  className="focus-ring code-room__chip code-room__chip--link"
                  data-tone={identity.pr.tone}
                  data-state={identity.pr.state}
                  data-testid="code-desk-pr"
                  href={identity.pr.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name={identity.pr.state === "merged" ? "ph:git-merge" : "ph:git-pull-request"} width={11} height={11} aria-hidden />
                  <span className="code-room__chip-value">{identity.pr.label}</span>
                  <span className="code-room__chip-state">{identity.pr.state}</span>
                </a>
              ) : (
                <span
                  className="code-room__chip"
                  data-tone={identity.pr.tone}
                  data-state={identity.pr.state}
                  data-testid="code-desk-pr"
                >
                  <Icon name="ph:git-pull-request" width={11} height={11} aria-hidden />
                  <span className="code-room__chip-value">{identity.pr.label}</span>
                  <span className="code-room__chip-state">{identity.pr.state}</span>
                </span>
              )
            ) : null}
            {identity.diff ? (
              <span
                className="code-room__chip"
                data-testid="code-desk-diffstat"
                // The tooltip reads the same figure the chip prints (#5720 review).
                title={`${identity.diff.additions} added, ${identity.diff.deletions} removed`}
              >
                <Icon name="ph:git-diff" width={11} height={11} aria-hidden />
                <span className="code-rail__add">+{identity.diff.additions}</span>
                <span className="code-rail__del">&minus;{identity.diff.deletions}</span>
              </span>
            ) : null}
            {reviewProgress ? (
              <span className="code-room__chip" data-testid="code-desk-progress" data-complete={viewedCount === changes.files.length ? "true" : undefined}>
                <Icon name="ph:eye" width={11} height={11} aria-hidden />
                {reviewProgress}
              </span>
            ) : null}
            <span className="code-room__chip code-room__chip--muted" title={row.updated_at}>
              {relativeTime(row.updated_at)}
            </span>
          </div>
        </div>
        <div className="code-room__header-actions" role="group" aria-label="Session controls">
          <button
            ref={inspectorAnchor}
            type="button"
            className="focus-ring code-room__action"
            aria-expanded={inspectorOpen}
            aria-label="Session inspector — branch, worktree, environment"
            title="Session inspector — branch, worktree, environment"
            onClick={() => setInspectorOpen((open) => !open)}
          >
            <Icon name="ph:sliders-bold" width={12} height={12} aria-hidden />
            Session
          </button>
          <button
            type="button"
            className="focus-ring code-room__action"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            onClick={() => setKeysOpen(true)}
          >
            <Icon name="ph:key-bold" width={12} height={12} aria-hidden />
            Shortcuts
          </button>
          <Button size="sm" onClick={() => onJumpToSession(row.id, row.familiarId)}>
            Open in Chat
          </Button>
        </div>
        <Popover
          open={inspectorOpen}
          onOpenChange={setInspectorOpen}
          anchorRef={inspectorAnchor}
          placement="bottom-end"
          minWidth={320}
          scrollStrategy="content"
          ariaLabel="Session inspector"
        >
          <div className="code-room__inspector">
            <CodeInspector row={row} onChanged={onRefresh} />
          </div>
        </Popover>
      </div>

      {/* Narrow: a step switcher stands in for the three columns. It is the
          only control that can bring a hidden column back, so it renders
          BEFORE the body — reachable by tab from the header, not after a
          full-height file list. */}
      {fitsSplit || prFull ? null : (
        <div role="tablist" aria-label="Workbench step" className="code-room__steps">
          {CODE_WORKBENCH_STEPS.map((id, index) => (
            <button
              key={id}
              ref={(node) => {
                if (node) stepTabRefs.current.set(id, node);
                else stepTabRefs.current.delete(id);
              }}
              type="button"
              role="tab"
              id={stepTabId(id)}
              // "Review pane", not "Review": the code surface's own tabs
              // already have a Review, and two same-named tabs on one
              // screen are indistinguishable by name (#5729).
              aria-label={`${STEP_LABEL[id]} pane`}
              aria-selected={step === id}
              // Only the shown step's panel exists to point at.
              aria-controls={step === id ? stepPanelId(id) : undefined}
              tabIndex={step === id ? 0 : -1}
              data-selected={step === id ? "true" : undefined}
              className="focus-ring code-room__step"
              onClick={() => setStep(id)}
              onKeyDown={(event) => {
                const next = codeTablistKeyTarget(event, index, CODE_WORKBENCH_STEPS.length);
                if (next === null) return;
                event.preventDefault();
                const target = CODE_WORKBENCH_STEPS[next];
                setStep(target);
                stepTabRefs.current.get(target)?.focus();
              }}
            >
              {STEP_LABEL[id]}
            </button>
          ))}
        </div>
      )}

      <div className="code-room__body" ref={roomRef} data-split={fitsSplit ? "true" : undefined}>
        {prFull && prRepo && prNumber != null ? (
          <LazyPrReader repo={prRepo} number={prNumber} onBack={() => setPrFull(false)} />
        ) : null}
        {prFull ? null : fitsSplit || step === "files" ? (
          <div className="code-room__tree" {...stepPanel("files")}>
            <CodeWorkbenchTree
              projectRoot={workRoot}
              familiarId={row.familiarId}
              selectedPath={selectedPath}
              onSelect={(path) => {
                openPath(path);
                // Picking a file on a narrow room is a request to READ it —
                // staying on the tree would look like the click did nothing.
                if (!fitsSplit) setStep("source");
              }}
              changes={changedFiles}
              repoRoot={changes.repoRoot}
              changedOnly={treeChangedOnly}
              changesStatus={changes.loaded ? (changes.ok ? "ready" : "unavailable") : "loading"}
              onChangedOnlyChange={setTreeChangedOnly}
            />
          </div>
        ) : null}
        {prFull ? null : fitsSplit || step === "source" ? (
          <div className="code-room__viewer" {...stepPanel("source")}>
            <CodeOpenFileTabs
              paths={openFiles.paths}
              active={openFiles.active}
              status={tabStatus}
              onSelect={selectTab}
              onClose={closeTab}
              idPrefix={fileTabPrefix}
              panelId={viewerPanelId}
            />
            {/* The open-file tabs' panel. Without tabs there is no tablist to
                belong to, so it is a plain container then. */}
            <div
              className="code-room__viewer-panel"
              id={viewerPanelId}
              role={activeTabIndex >= 0 ? "tabpanel" : undefined}
              aria-labelledby={activeTabIndex >= 0 ? codeOpenFileTabId(fileTabPrefix, activeTabIndex) : undefined}
            >
              <RailFilePreview
                path={selectedPath}
                projectRoot={workRoot}
                familiarId={row.familiarId}
                onOpenPath={openPath}
                variant="workbench"
                rangeLabel={rangeLabel}
                initialLine={focusLine}
              />
            </div>
          </div>
        ) : null}
        {prFull ? null : fitsSplit || step === "review" ? (
          <CodeReviewRail
            row={row}
            projectRoot={workRoot}
            running={running}
            tab={railTab}
            onTabChange={setRailTab}
            // A rail closed to its spine while the room was wide must not
            // survive into the narrow step — the Review step would render a
            // 28px sliver with no control to recover it. The state itself is
            // left alone so returning to the split restores what you chose.
            open={fitsSplit ? panels.reviewOpen : true}
            onOpenChange={fitsSplit ? onReviewOpenChange : () => setStep("source")}
            widthPx={fitsSplit ? railWidth : roomWidth}
            onWidthChange={setRailWidth}
            roomWidthPx={roomWidth}
            // The narrow Review step fills the room: a grip and a widen
            // control there would change nothing visible (#5729).
            resizable={fitsSplit}
            stepPanel={fitsSplit ? undefined : { id: stepPanelId("review"), labelledBy: stepTabId("review") }}
            focusPath={reviewFocus?.path}
            focusNonce={reviewFocus?.nonce}
            onOpenFullPr={prRepo && prNumber != null ? () => setPrFull(true) : undefined}
            files={changes.files}
            viewed={viewed}
            onToggleViewed={toggleViewed}
            nextUnviewed={nextUnviewed}
            onOpenNextUnviewed={openNextUnviewed}
            onPanelFilesChange={setPanelFiles}
          />
        ) : null}
      </div>

      <CodeTerminalDrawer
        toggleHint={terminalHint}
        releaseKey={terminalReleaseKey}
        sessionId={row.id}
        projectRoot={workRoot}
        running={running}
        open={panels.terminalOpen}
        onOpenChange={onTerminalOpenChange}
        bodyHeightPx={bodyHeight}
      />

      <CodeComposer
        key={row.id}
        row={row}
        initialDraft={codeDeskMemory.read(row.id)?.draft ?? ""}
        onDraftChange={(draft) => codeDeskMemory.write(row.id, { draft })}
        onJumpToSession={onJumpToSession}
        contextPath={selectedRelative}
        rangeLabel={rangeLabel}
        hasChanges={changedFiles.length > 0}
        hasPr={Boolean(pr)}
      />

      <CodeShortcutsDialog
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
        keymap={keymap}
        onChange={updateKeymap}
      />
    </div>
  );
}

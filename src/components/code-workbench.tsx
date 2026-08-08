"use client";

/**
 * CodeWorkbench — the Coding Room's per-session workbench (cave-k0ua,
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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/styles/globals/surface-code-room.css";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { relativeTime } from "@/lib/relative-time";
import { CodeComposer } from "@/components/code-composer";
import { CodeReviewRail } from "@/components/code-review-rail";
import { CodeSessionPicker } from "@/components/code-session-picker";
import { CodeShortcutsDialog } from "@/components/code-shortcuts-dialog";
import { CodeTerminalDrawer } from "@/components/code-terminal-drawer";
import { CodeWorkbenchTree } from "@/components/code-workbench-tree";
import dynamic from "next/dynamic";
import { CodeInspector } from "@/components/code-inspector";
import { RailFilePreview } from "@/components/rail-file-preview";
import { useAnnouncer } from "@/components/ui/live-region";
import { useIsMobile } from "@/lib/use-viewport";
import { useMeasuredWidth } from "@/lib/use-measured-width";
import {
  CODE_STEP_ANNOUNCEMENT,
  CODE_WORKBENCH_STEPS,
  codeRailTabForWorkbenchTab,
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  codeSessionWorkRoot,
  codeWorkbenchFitsSplit,
  type CodeWorkbenchStep,
  type CodeWorkbenchTab,
} from "@/lib/code-surface";
import {
  CODE_RAIL_DEFAULT_WIDTH_PX,
  clampCodeRailWidth,
  type CodeRailTab,
} from "@/lib/code-side-rail";
import {
  CODE_SHORTCUT_STORAGE_KEY,
  codeComboFromEvent,
  codeShortcutForCombo,
  isCodeShortcutTarget,
  defaultCodeKeymap,
  mergeCodeKeymap,
  type CodeShortcutId,
} from "@/lib/code-shortcuts";
import { useWorktreeChanges } from "@/lib/use-worktree-changes";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
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
  sessions,
  initialTab,
  openTarget,
  onSelectSession,
  onNewSession,
  onJumpToSession,
  onRefresh,
}: {
  row: SessionRow;
  /** Every code session, for the header picker. */
  sessions: SessionRow[];
  /** Deep-linked review tab (?wtab=), mapped through the rail vocabulary. */
  initialTab?: CodeWorkbenchTab;
  /** A routed file/diff open (cave-ohcj): lands on the file or the review rail
   *  with that path focused. `nonce` re-triggers the jump for a repeat path. */
  openTarget?: PendingCodeOpen;
  onSelectSession?: (sessionId: string) => void;
  onNewSession?: (title: string) => void;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  /** Re-poll the enriched session list (branch/worktree chips) after inspector mutations. */
  onRefresh?: () => void;
}) {
  const workRoot = codeSessionWorkRoot(row);
  const branch = codeSessionBranch(row);
  const diffstat = codeSessionDiffstat(row);
  const pr = row.pullRequest;
  const prRepo = pr?.repo ?? null;
  const prNumber = pr?.number ?? null;
  const running = codeSessionActivity(row) === "running";

  // ── Layout state ───────────────────────────────────────────────────────────
  // Measured against the workbench's OWN body, not the viewport: this renders
  // inside the role-surface host beside the app sidebar and can be placed in a
  // split, so the viewport says nothing useful about the width the three
  // columns actually got. `useIsMobile` only stands in for the frames before
  // the first measurement lands.
  const roomRef = useRef<HTMLDivElement | null>(null);
  const measuredWidth = useMeasuredWidth(roomRef);
  const isMobile = useIsMobile();
  const roomWidth = measuredWidth ?? (isMobile ? 390 : 1200);

  const [railTab, setRailTab] = useState<CodeRailTab>(() =>
    codeRailTabForWorkbenchTab(initialTab) ?? "changes",
  );
  const [railOpen, setRailOpen] = useState(true);
  const [railWidth, setRailWidth] = useState(CODE_RAIL_DEFAULT_WIDTH_PX);
  const [treeChangedOnly, setTreeChangedOnly] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
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
  const [step, setStep] = useState<CodeWorkbenchStep>("source");
  const { announce } = useAnnouncer();
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [rangeLabel, setRangeLabel] = useState<string | null>(null);
  useEffect(() => {
    setSelectedPath(null);
    setFocusLine(null);
    setRangeLabel(null);
    setTreeChangedOnly(false);
    setPrFull(false);
  }, [row.id]);

  const openPath = useCallback(
    (path: string) => {
      setSelectedPath(
        path.startsWith("/") ? path : `${workRoot.replace(/\/$/, "")}/${path.replace(/^\.?\//, "")}`,
      );
    },
    [workRoot],
  );

  // A routed open outranks whatever the room was showing: a diff jump selects
  // the review rail, a file open selects the file — and either one reopens a
  // closed rail (and drills the narrow room to the right step) so the routed
  // target is actually visible rather than silently correct behind something.
  useEffect(() => {
    if (!openTarget) return;
    setRangeLabel(openTarget.origin?.selectionLabel ?? null);
    if (openTarget.kind === "changes") {
      setRailTab("changes");
      setRailOpen(true);
      setStep("review");
    } else if (openTarget.path) {
      openPath(openTarget.path);
      setFocusLine(openTarget.line ?? null);
      setStep("source");
    }
  }, [openPath, openTarget]);

  const changes = useWorktreeChanges(workRoot, running);

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
      // Never steal a keystroke from a field — the composer, the picker's
      // filter, the editor — nor from a focused TERMINAL pane, where Ctrl+P
      // and Ctrl+C belong to the shell. Both exclusions live in one predicate
      // so the room and the terminal cannot disagree about who owns a key.
      if (!isCodeShortcutTarget(event.target)) return;
      const action = codeShortcutForCombo(keymap, codeComboFromEvent(event));
      if (!action) return;
      event.preventDefault();
      if (action === "help") setKeysOpen((open) => !open);
      else if (action === "terminal") setTermOpen((open) => !open);
      else if (action === "changes") {
        setRailTab("changes");
        setRailOpen(true);
      } else if (action === "pr") {
        setRailTab("pr");
        setRailOpen(true);
      } else if (action === "files") {
        roomRef.current?.querySelector<HTMLElement>('[role="tree"]')?.focus();
      } else if (action === "outline") {
        roomRef.current
          ?.querySelector<HTMLElement>('.workspace-rail__preview-action[aria-expanded]')
          ?.click();
      } else if (action === "prompt") {
        roomRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      } else if (action === "picker") {
        roomRef.current?.querySelector<HTMLElement>(".code-picker__trigger")?.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keymap]);

  const changedFiles = useMemo(() => changes.files, [changes.files]);

  return (
    <div className="code-room" data-testid="code-workbench">
      <div className="code-room__header" data-testid="code-workbench-header">
        <CodeSessionPicker
          sessions={sessions}
          selected={row}
          onSelect={(id) => onSelectSession?.(id)}
          onCreate={onNewSession}
        />
        <div className="code-room__facts">
          {branch ? (
            <span className="code-room__fact" title={workRoot}>
              <Icon name="ph:git-branch" width={10} height={10} aria-hidden />
              <span className="code-room__fact-value">{branch}</span>
              {row.git?.isWorktree ? <span className="code-room__fact-note">worktree</span> : null}
            </span>
          ) : null}
          {diffstat ? <span className="code-room__fact">{diffstat}</span> : null}
          {pr?.url ? (
            <a
              className="focus-ring code-room__fact code-room__fact--link"
              href={pr.url}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="ph:git-pull-request" width={10} height={10} aria-hidden />
              {pr.number != null ? `#${pr.number}` : "PR"}
              {pr.state ? <span className="code-room__fact-note">{pr.state}</span> : null}
            </a>
          ) : null}
          <span className="code-room__fact code-room__fact--muted">
            {relativeTime(row.updated_at)}
          </span>
        </div>
        <span className="code-room__spacer" />
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
        </button>
        <button
          type="button"
          className="focus-ring code-room__action"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={() => setKeysOpen(true)}
        >
          <Icon name="ph:key-bold" width={12} height={12} aria-hidden />
        </button>
        <Button size="sm" onClick={() => onJumpToSession(row.id, row.familiarId)}>
          Open in Chat
        </Button>
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
          {CODE_WORKBENCH_STEPS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={step === id}
              data-selected={step === id ? "true" : undefined}
              className="focus-ring code-room__step"
              onClick={() => setStep(id)}
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
          <div className="code-room__tree">
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
              onChangedOnlyChange={setTreeChangedOnly}
            />
          </div>
        ) : null}
        {prFull ? null : fitsSplit || step === "source" ? (
          <div className="code-room__viewer">
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
            open={fitsSplit ? railOpen : true}
            onOpenChange={fitsSplit ? setRailOpen : () => setStep("source")}
            widthPx={fitsSplit ? railWidth : roomWidth}
            onWidthChange={setRailWidth}
            roomWidthPx={roomWidth}
            focusPath={openTarget?.kind === "changes" ? openTarget.path : undefined}
            focusNonce={openTarget?.kind === "changes" ? openTarget.nonce : undefined}
            onOpenFullPr={prRepo && prNumber != null ? () => setPrFull(true) : undefined}
          />
        ) : null}
      </div>

      <CodeTerminalDrawer
        sessionId={row.id}
        projectRoot={workRoot}
        running={running}
        open={termOpen}
        onOpenChange={setTermOpen}
      />

      <CodeComposer row={row} onJumpToSession={onJumpToSession} />

      <CodeShortcutsDialog
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
        keymap={keymap}
        onChange={updateKeymap}
      />
    </div>
  );
}

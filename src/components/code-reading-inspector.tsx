"use client";

import "@/styles/code-reading.css";

/**
 * CodeReadingInspector — reading a chat code block against the truth on disk
 * (cave-f6mu9).
 *
 * A model's code block is a claim about a file. This panel is where the claim
 * gets checked: **Snippet** is what was said, **Working tree** is what the file
 * actually contains now, and **Compare** is the difference between them. A
 * block that has drifted says so in the header instead of being quietly read as
 * current.
 *
 * The reader can select lines (click, shift-click to extend) and carry the
 * selection onward — as a reference chip in their reply, as a quote in the
 * composer, to the clipboard, or into the Code workshop with the range intact.
 * Every action is gated on provenance, so nothing offers what it cannot do:
 * a quoted block has no working tree to open, a patch has no single file.
 *
 * Layout follows the reader's pin (auto / split / overlay) narrowed by the
 * viewport — see resolveInspectorMode. Split and overlay are non-modal (the
 * conversation stays live behind them); only the phone-width modal traps focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { useAnnouncer } from "@/components/ui/live-region";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { highlightToHtml } from "@/components/message-bubble";
import { splitHighlightedLines } from "@/lib/code-lines";
import { diffLines, type LineDiffOp } from "@/lib/line-diff";
import { resolveLangLabel } from "@/lib/code-lang";
import {
  canOpenInWorkshop,
  extendSelection,
  inspectorTabs,
  isLineSelected,
  normalizeInspectorTab,
  provenanceLabel,
  provenanceTitle,
  quotedSnippet,
  referenceChipLabel,
  resolveInspectorMode,
  selectedText,
  selectionLabel,
  snippetStartLine,
  stalenessForRead,
  stalenessLabel,
  stalenessTitle,
  type CodeProvenance,
  type Staleness,
  type InspectorMode,
  type InspectorPin,
  type InspectorTabId,
  type LineSelection,
} from "@/lib/code-reading";

// ── Types ────────────────────────────────────────────────────────────────────

export type CodeReadingOrigin = {
  /** Chat session title, for the "from …" line in the workshop handoff. */
  sessionTitle?: string | null;
  /** Familiar that produced the block. */
  familiar?: string | null;
  /** 1-based message position in the transcript. */
  messageIndex?: number | null;
};

export type CodeReadingTarget = {
  code: string;
  lang: string;
  /** Repo-relative path when the fence named one. */
  path: string | null;
  /** Immutable execution root captured from the transcript turn. */
  projectRoot: string | null;
  provenance: CodeProvenance;
  /** Tab to land on. Compare jumps straight to the difference. */
  tab: InspectorTabId;
  origin?: CodeReadingOrigin;
};

export type CodeReadingInspectorProps = {
  target: CodeReadingTarget;
  /** Absolute project root. Null disables the working-tree read. */
  projectRoot: string | null;
  pin: InspectorPin;
  onPinChange: (pin: InspectorPin) => void;
  onClose: () => void;
  /** Drop a `file.ts:14-19` reference into the composer. */
  onReference?: (label: string) => void;
  /** Insert a fenced quote of the selection into the composer. */
  onQuote?: (markdown: string) => void;
  /** Open the file in the Code workshop, carrying the selected range. */
  onOpenInWorkshop?: (request: {
    path: string;
    line: number | null;
    /** "lines 14–19" — what the reader had selected when they handed off. */
    selectionLabel: string | null;
    origin?: CodeReadingOrigin;
  }) => void;
};

type DiskState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; content: string }
  // `absent` is a claim about the repository ("this file is gone"); `error` is
  // a claim about us ("I could not look"). Only the first earns a badge.
  | { phase: "absent" }
  | { phase: "error"; message: string };

// ── Working-tree read ────────────────────────────────────────────────────────

function useWorkingTree(projectRoot: string | null, path: string | null, enabled: boolean): DiskState {
  const [state, setState] = useState<DiskState>({ phase: "idle" });
  useEffect(() => {
    if (!enabled || !projectRoot || !path) {
      setState({ phase: "idle" });
      return;
    }
    let cancelled = false;
    setState({ phase: "loading" });
    const abs = `${projectRoot.replace(/[/\\]+$/, "")}/${path.replace(/^[/\\]+/, "")}`;
    (async () => {
      try {
        const res = await fetch(`/api/project-file?path=${encodeURIComponent(abs)}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) {
          setState({ phase: "absent" });
          return;
        }
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; kind?: string; content?: string; error?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          setState({ phase: "error", message: json?.error ?? "could not read the file" });
          return;
        }
        if (json.kind !== "text" || typeof json.content !== "string") {
          setState({ phase: "error", message: "not a text file" });
          return;
        }
        setState({ phase: "ready", content: json.content });
      } catch {
        if (!cancelled) setState({ phase: "error", message: "no connection to the worktree" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, path, enabled]);
  return state;
}

// ── Highlighting ─────────────────────────────────────────────────────────────

function useHighlightedLines(source: string, lang: string): string[] {
  const [lines, setLines] = useState<string[]>(() =>
    splitHighlightedLines("", source),
  );
  useEffect(() => {
    let cancelled = false;
    // Plain escaped lines render immediately; colors swap in when Shiki
    // resolves. The row geometry is identical either way, so nothing reflows.
    setLines(splitHighlightedLines("", source));
    (async () => {
      try {
        const html = await highlightToHtml(source, lang);
        if (!cancelled) setLines(splitHighlightedLines(html, source));
      } catch {
        // Unknown grammar or a failed WASM load: the escaped fallback stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, lang]);
  return lines;
}

// ── Viewport ─────────────────────────────────────────────────────────────────

function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function CodeRows({
  lines,
  startLine,
  selection,
  onPickLine,
}: {
  lines: string[];
  startLine: number;
  selection: LineSelection | null;
  onPickLine: ((line: number, shiftKey: boolean) => void) | null;
}) {
  return (
    // Deliberately NOT a listbox: selecting lines is a range built from
    // toggles, not a single-select list, and listbox semantics would also
    // require the options to be this element's direct children (they are
    // nested inside each row). A group of pressed/unpressed buttons is what
    // this actually is, so that is what it announces.
    <div className="cri-code" role={onPickLine ? "group" : undefined} aria-label={onPickLine ? "Code lines" : undefined}>
      {lines.map((html, i) => {
        const n = startLine + i;
        const selected = isLineSelected(selection, n);
        return (
          <div
            key={n}
            className={`cri-row${selected ? " cri-row--selected" : ""}`}
            data-line={n}
          >
            {onPickLine ? (
              <button
                type="button"
                className="cri-ln focus-ring"
                aria-pressed={selected}
                aria-label={`Select line ${n}`}
                onClick={(event) => onPickLine(n, event.shiftKey)}
              >
                {n}
              </button>
            ) : (
              <span className="cri-ln cri-ln--static" aria-hidden="true">
                {n}
              </span>
            )}
            <code className="cri-src" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        );
      })}
    </div>
  );
}

function DiffRows({ ops }: { ops: LineDiffOp[] }) {
  return (
    <div className="cri-code">
      {ops.map((op, i) => (
        <div key={i} className={`cri-row cri-row--${op.type}`}>
          <span className="cri-ln cri-ln--static" aria-hidden="true">
            {op.type === "add" ? "+" : op.type === "del" ? "−" : " "}
          </span>
          <code className="cri-src">{op.text}</code>
        </div>
      ))}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function CodeReadingInspector({
  target,
  projectRoot,
  pin,
  onPinChange,
  onClose,
  onReference,
  onQuote,
  onOpenInWorkshop,
}: CodeReadingInspectorProps) {
  const { announce } = useAnnouncer();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const viewportWidth = useViewportWidth();
  const mode: InspectorMode = resolveInspectorMode(pin, viewportWidth);

  const tabs = useMemo(() => inspectorTabs(target.provenance), [target.provenance]);
  const [tab, setTab] = useState<InspectorTabId>(() =>
    normalizeInspectorTab(target.tab, target.provenance),
  );
  const [selection, setSelection] = useState<LineSelection | null>(null);

  // A new target is a new read: reset the tab and drop a selection that refers
  // to line numbers in a different file.
  useEffect(() => {
    setTab(normalizeInspectorTab(target.tab, target.provenance));
    setSelection(null);
  }, [target]);

  // The working tree is needed for the staleness verdict in the header, not
  // just for the file/compare tabs — the header must be able to say "stale"
  // while the reader is still looking at the snippet.
  const wantsDisk = target.provenance === "file-backed" && Boolean(target.path);
  const disk = useWorkingTree(projectRoot, target.path, wantsDisk);
  const diskContent = disk.phase === "ready" ? disk.content : null;

  // A read failure is `unknown`, not `missing` — the error still shows in the
  // File/Compare tabs, but the header never claims a file is gone on the
  // strength of a permission denial or an offline daemon.
  const stale: Staleness = !wantsDisk || disk.phase === "loading" || disk.phase === "idle"
    ? "unknown"
    : stalenessForRead(
        target.code,
        disk.phase === "ready"
          ? { kind: "text", content: disk.content }
          : disk.phase === "absent"
            ? { kind: "absent" }
            : { kind: "unreadable" },
      );
  const staleText = stalenessLabel(stale);

  // Where the snippet sits in the file, so line numbers in the Snippet tab are
  // the file's real ones rather than a 1..n that matches nothing.
  const snippetStart = useMemo(
    () => (diskContent ? snippetStartLine(target.code, diskContent) : null),
    [target.code, diskContent],
  );
  const snippetBase = snippetStart ?? 1;

  const source = tab === "file" ? diskContent ?? "" : target.code;
  const lines = useHighlightedLines(source, target.lang);
  const diffOps = useMemo(
    () => (tab === "compare" && diskContent !== null ? diffLines(target.code, diskContent) : []),
    [tab, target.code, diskContent],
  );

  const pickLine = useCallback((line: number, shiftKey: boolean) => {
    setSelection((current) => extendSelection(current, line, shiftKey));
  }, []);

  // Only the phone-width modal is modal. A split or overlay inspector sits
  // beside a live conversation; trapping focus there would strand the reader
  // away from the composer they opened it to write in.
  useFocusTrap(mode === "modal", panelRef, { onEscape: onClose });

  // Escape closes the non-modal layouts too (the trap owns it for the modal).
  useEffect(() => {
    if (mode === "modal") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const label = selectionLabel(selection);
  const displayName = target.path?.split("/").pop() ?? "snippet";
  const displayDir = target.path?.split("/").slice(0, -1).join("/") ?? "";

  const doCopy = useCallback(() => {
    void copyText(selectedText(target.code, selection)).then((ok) => {
      announce(ok ? `Copied ${label ?? "the snippet"}` : "Could not copy");
    });
  }, [announce, label, selection, target.code]);

  const doReference = useCallback(() => {
    if (!onReference) return;
    const chip = referenceChipLabel({ name: displayName, path: target.path }, selection);
    onReference(chip);
    announce(`Referenced ${chip} in your reply`);
  }, [announce, displayName, onReference, selection, target.path]);

  const doQuote = useCallback(() => {
    if (!onQuote) return;
    onQuote(quotedSnippet({ name: displayName, path: target.path, lang: target.lang }, target.code, selection));
    announce("Quoted into the composer");
  }, [announce, displayName, onQuote, selection, target.code, target.lang, target.path]);

  const doOpen = useCallback(() => {
    if (!onOpenInWorkshop || !target.path) return;
    // The selection is numbered against the file when we know where the
    // snippet starts, so the workshop lands on the same lines the reader
    // selected here rather than on line 1.
    const line = selection ? selection.from : snippetStart;
    onOpenInWorkshop({
      path: target.path,
      line: line ?? null,
      selectionLabel: label,
      origin: target.origin,
    });
    announce(`Opening ${displayName} in the workshop`);
  }, [announce, displayName, label, onOpenInWorkshop, selection, snippetStart, target.origin, target.path]);

  const canOpen =
    canOpenInWorkshop(target.provenance) &&
    Boolean(target.path) &&
    Boolean(projectRoot) &&
    Boolean(onOpenInWorkshop);

  return (
    <>
      {mode === "modal" ? <div className="cri-backdrop" onClick={onClose} aria-hidden="true" /> : null}
      <div
        ref={panelRef}
        className={`cri cri--${mode}`}
        role={mode === "modal" ? "dialog" : "complementary"}
        aria-modal={mode === "modal" ? true : undefined}
        aria-label={`Reading ${displayName}`}
      >
        <header className="cri-head">
          <span className={`cri-prov cri-prov--${target.provenance}`} title={provenanceTitle(target.provenance)}>
            {provenanceLabel(target.provenance)}
          </span>
          <span className="cri-name" title={target.path ?? displayName}>
            {displayName}
          </span>
          {displayDir ? <span className="cri-dir">{displayDir}</span> : null}
          <span className="cri-lang">{resolveLangLabel(target.lang)}</span>
          {staleText ? (
            <span className={`cri-stale cri-stale--${stale}`} title={stalenessTitle(stale) ?? undefined}>
              <Icon name="ph:warning" width={11} />
              {staleText}
            </span>
          ) : null}
          <span className="cri-spacer" />
          <div className="cri-pins" role="group" aria-label="Where the inspector opens">
            {(["auto", "split", "overlay"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`cri-pin focus-ring${pin === option ? " cri-pin--on" : ""}`}
                aria-pressed={pin === option}
                onClick={() => onPinChange(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <button type="button" className="cri-close focus-ring" onClick={onClose} aria-label="Close the inspector">
            <Icon name="ph:x" width={12} />
          </button>
        </header>

        {tabs.length > 1 ? (
          <div className="cri-tabs" role="tablist" aria-label="What to read">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className={`cri-tab focus-ring${tab === entry.id ? " cri-tab--on" : ""}`}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="cri-body">
          {tab === "snippet" ? (
            <CodeRows
              lines={lines}
              startLine={snippetBase}
              selection={selection}
              onPickLine={pickLine}
            />
          ) : null}

          {tab === "file" ? (
            disk.phase === "loading" ? (
              <p className="cri-note">Reading the working tree…</p>
            ) : disk.phase === "ready" ? (
              <CodeRows lines={lines} startLine={1} selection={selection} onPickLine={pickLine} />
            ) : (
              <p className="cri-note cri-note--bad">
                {!projectRoot ? "No project root for this session." : disk.phase === "absent" ? "This file is not in the working tree any more." : disk.phase === "error" ? disk.message : "Nothing to read yet."}
              </p>
            )
          ) : null}

          {tab === "compare" ? (
            disk.phase === "loading" ? (
              <p className="cri-note">Reading the working tree…</p>
            ) : disk.phase === "ready" ? (
              diffOps.length === 0 ? (
                <p className="cri-note">The snippet matches the working tree exactly.</p>
              ) : (
                <DiffRows ops={diffOps} />
              )
            ) : (
              <p className="cri-note cri-note--bad">
                {!projectRoot ? "No project root for this session." : disk.phase === "absent" ? "This file is not in the working tree any more — nothing to compare against." : disk.phase === "error" ? disk.message : "Nothing to compare yet."}
              </p>
            )
          ) : null}
        </div>

        <footer className="cri-foot">
          <span className="cri-sel">
            {label ? label : "Click a line number to select · shift-click to extend"}
          </span>
          {selection ? (
            <button type="button" className="cri-clear focus-ring" onClick={() => setSelection(null)}>
              clear
            </button>
          ) : null}
          <span className="cri-spacer" />
          {onReference ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--xs focus-ring" onClick={doReference}>
              Reference in reply
            </button>
          ) : null}
          {onQuote ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--xs focus-ring" onClick={doQuote}>
              Quote
            </button>
          ) : null}
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--xs focus-ring" onClick={doCopy}>
            <Icon name="ph:copy" width={11} />
            Copy
          </button>
          {canOpen ? (
            <button type="button" className="ui-btn ui-btn--primary ui-btn--xs focus-ring" onClick={doOpen}>
              Open in workshop
              <Icon name="ph:arrow-square-out" width={11} />
            </button>
          ) : null}
        </footer>
      </div>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { Familiar } from "@/lib/types";

export type ResearchResult = { id: string; collection: string; title: string; familiar: string };

type Props = {
  open: boolean;
  onClose: () => void;
  familiars: Familiar[];
  defaultTopic?: string;
  defaultFamiliarId?: string;
  /** Fired when a research run finishes and the doc has been written. */
  onComplete: (result: ResearchResult) => void;
};

type RunState =
  | { phase: "idle" }
  | { phase: "running"; status: string }
  | { phase: "error"; error: string };

/** Starter prompts that fill the topic — a one-click way into a good question. */
const EXAMPLE_TOPICS = [
  "How do AI agent harnesses manage tool permissions?",
  "Compare vector databases for RAG in 2026",
  "The state of on-device LLM inference",
  "Best practices for prompt-caching with Claude",
];

/**
 * The phases a research run moves through. The backend streams a single coarse
 * status, so these advance on a gentle timer to communicate *what's happening*
 * during the wait — the live status text is shown as the caption beneath them.
 * The final phase holds until the document actually lands.
 */
const RESEARCH_PHASES = [
  { icon: "ph:graph", label: "Planning the approach" },
  { icon: "ph:globe", label: "Searching the web" },
  { icon: "ph:books", label: "Reading & vetting sources" },
  { icon: "ph:brain", label: "Synthesizing findings" },
  { icon: "ph:note-pencil", label: "Writing the cited brief" },
] as const;

/**
 * Modal composer for the `/research` flow. Takes a topic + familiar, streams a
 * research run from POST /api/library/research, and hands the resulting Library
 * doc back to the parent (which navigates to it). The run keeps streaming even
 * if the modal is closed mid-flight — closing simply aborts.
 */
export function LibraryResearchComposer({
  open,
  onClose,
  familiars,
  defaultTopic = "",
  defaultFamiliarId,
  onComplete,
}: Props) {
  const [topic, setTopic] = useState(defaultTopic);
  const [familiarId, setFamiliarId] = useState(defaultFamiliarId ?? familiars[0]?.id ?? "");
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const [phaseIdx, setPhaseIdx] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useFocusTrap(open, dialogRef);

  const running = run.phase === "running";

  useEffect(() => {
    if (!open) return;
    setTopic(defaultTopic);
    setRun({ phase: "idle" });
    setPhaseIdx(0);
    if (defaultFamiliarId) setFamiliarId(defaultFamiliarId);
    else if (!familiarId && familiars[0]) setFamiliarId(familiars[0].id);
  }, [open, defaultTopic, defaultFamiliarId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abortRef.current?.abort(), []);

  // Advance the phase indicator while running (holds on the final phase). Pure
  // visual pacing for an otherwise opaque wait; the real status is the caption.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setPhaseIdx((i) => Math.min(i + 1, RESEARCH_PHASES.length - 1));
    }, 7000);
    return () => clearInterval(id);
  }, [running]);

  const activeFamiliar = useMemo(
    () => familiars.find((f) => f.id === familiarId) ?? null,
    [familiars, familiarId],
  );

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }, [onClose]);

  const start = useCallback(async () => {
    const t = topic.trim();
    if (t.length < 3) {
      setRun({ phase: "error", error: "Enter a topic of at least 3 characters." });
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhaseIdx(0);
    setRun({ phase: "running", status: "Starting research…" });

    let res: Response;
    try {
      res = await fetch("/api/library/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: t, familiarId }),
        signal: ctrl.signal,
      });
    } catch {
      if (!ctrl.signal.aborted) setRun({ phase: "error", error: "Couldn't reach the research service." });
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setRun({ phase: "error", error: "No response stream." });
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let completed: ResearchResult | null = null;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          const line = block.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.kind === "status" && typeof evt.text === "string") {
            setRun({ phase: "running", status: evt.text });
          } else if (evt.kind === "doc") {
            completed = {
              id: String(evt.id),
              collection: String(evt.collection),
              title: String(evt.title),
              familiar: String(evt.familiar),
            };
          } else if (evt.kind === "error" && typeof evt.error === "string") {
            setRun({ phase: "error", error: evt.error });
            return;
          }
        }
      }
    } catch {
      if (ctrl.signal.aborted) return;
      setRun({ phase: "error", error: "The research stream was interrupted." });
      return;
    }

    if (completed) {
      abortRef.current = null;
      onComplete(completed);
    } else {
      setRun({ phase: "error", error: "Research finished without producing a document." });
    }
  }, [topic, familiarId, onComplete]);

  if (!open || typeof document === "undefined") return null;

  const canRun = topic.trim().length >= 3 && !running;

  return createPortal(
    <div
      ref={dialogRef}
      className="library-research-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="New research"
      onClick={(e) => { if (e.target === e.currentTarget && !running) close(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !running) close(); }}
      tabIndex={-1}
    >
      <div className="library-research-modal" data-running={running || undefined}>
        <div className="library-research-modal__head">
          <span className="library-research-modal__badge" aria-hidden>
            <Icon name="ph:flask" width={18} />
          </span>
          <span className="library-research-modal__heading">
            <span className="library-research-modal__title">New research</span>
            <span className="library-research-modal__subtitle">
              A familiar digs in and saves a cited brief to your Library.
            </span>
          </span>
          {!running && (
            <button
              type="button"
              className="library-research-modal__close"
              onClick={close}
              aria-label="Close"
              title="Close (esc)"
            >
              <Icon name="ph:x" width={14} />
            </button>
          )}
        </div>

        <div className="library-research-modal__body">
          {running ? (
            <ResearchProgress
              topic={topic}
              status={run.phase === "running" ? run.status : ""}
              phaseIdx={phaseIdx}
              familiarName={activeFamiliar?.display_name ?? activeFamiliar?.name ?? null}
            />
          ) : (
            <>
              <textarea
                ref={inputRef}
                className="library-research-input"
                placeholder="What should the familiar research? e.g. “How do AI agent harnesses manage tool permissions?”"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void start(); }
                }}
              />

              <div className="library-research-examples" aria-label="Example topics">
                <span className="library-research-examples__label">Try</span>
                {EXAMPLE_TOPICS.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="library-research-chip"
                    onClick={() => { setTopic(ex); inputRef.current?.focus(); }}
                    title={ex}
                  >
                    {ex}
                  </button>
                ))}
              </div>

              <div className="library-research-row">
                <label className="library-research-field">
                  <span className="library-research-field__label">Researcher</span>
                  <div className="library-research-select-wrap">
                    <Icon name="ph:user" width={14} aria-hidden />
                    <select
                      id="research-familiar"
                      className="library-research-familiar"
                      value={familiarId}
                      onChange={(e) => setFamiliarId(e.target.value)}
                      disabled={familiars.length === 0}
                    >
                      {familiars.length === 0 && <option value="">No familiars</option>}
                      {familiars.map((f) => (
                        <option key={f.id} value={f.id}>{f.display_name ?? f.name ?? f.id}</option>
                      ))}
                    </select>
                    <Icon name="ph:caret-up-down" width={12} className="library-research-select-caret" aria-hidden />
                  </div>
                </label>
                <button
                  type="button"
                  className="library-research-run"
                  onClick={() => void start()}
                  disabled={!canRun}
                >
                  <Icon name="ph:magnifying-glass" width={14} />
                  <span>Run research</span>
                  <kbd className="library-research-run__kbd">⌘↵</kbd>
                </button>
              </div>

              {run.phase === "error" && (
                <div className="library-research-status library-research-status--error">
                  <Icon name="ph:warning" width={14} />
                  <span>{run.error}</span>
                </div>
              )}
              {run.phase === "idle" && (
                <p className="library-research-hint">
                  <Icon name="ph:books" width={13} aria-hidden /> Saved to your Library’s
                  <strong> Research</strong> collection with sources you can verify.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The streaming state: a staged checklist with the live status as caption. */
function ResearchProgress({
  topic,
  status,
  phaseIdx,
  familiarName,
}: {
  topic: string;
  status: string;
  phaseIdx: number;
  familiarName: string | null;
}) {
  const pct = Math.round(((phaseIdx + 1) / RESEARCH_PHASES.length) * 100);
  return (
    <div className="library-research-progress" role="status" aria-live="polite">
      <p className="library-research-progress__topic">
        {familiarName ? <strong>{familiarName}</strong> : "A familiar"} is researching
        <span className="library-research-progress__topic-text"> “{topic.trim()}”</span>
      </p>

      <ul className="library-research-steps">
        {RESEARCH_PHASES.map((p, i) => {
          const state = i < phaseIdx ? "done" : i === phaseIdx ? "active" : "todo";
          return (
            <li key={p.label} className="library-research-step" data-state={state}>
              <span className="library-research-step__dot" aria-hidden>
                {state === "done" ? (
                  <Icon name="ph:check-bold" width={11} />
                ) : state === "active" ? (
                  <span className="library-research-step__spin" />
                ) : (
                  <Icon name={p.icon} width={12} />
                )}
              </span>
              <span className="library-research-step__label">{p.label}</span>
            </li>
          );
        })}
      </ul>

      <div className="library-research-progress__bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      {status ? <p className="library-research-progress__caption">{status}</p> : null}
      <p className="library-research-progress__note">
        This can take a minute or two. You can close this — research keeps running and the brief
        will appear in your Library when it’s done.
      </p>
    </div>
  );
}

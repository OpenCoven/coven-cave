"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    setTopic(defaultTopic);
    setRun({ phase: "idle" });
    if (defaultFamiliarId) setFamiliarId(defaultFamiliarId);
    else if (!familiarId && familiars[0]) setFamiliarId(familiars[0].id);
  }, [open, defaultTopic, defaultFamiliarId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abortRef.current?.abort(), []);

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

  const running = run.phase === "running";

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
      <div className="library-research-modal">
        <div className="library-research-modal__head">
          <Icon name="ph:flask" width={16} />
          <span>New research</span>
        </div>
        <div className="library-research-modal__body">
          <textarea
            className="library-research-input"
            placeholder="What should the familiar research? e.g. “How do AI agent harnesses manage tool permissions?”"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={running}
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void start(); }
            }}
          />
          <div className="library-research-row">
            <label className="sr-only" htmlFor="research-familiar">Familiar</label>
            <select
              id="research-familiar"
              className="library-research-familiar"
              value={familiarId}
              onChange={(e) => setFamiliarId(e.target.value)}
              disabled={running || familiars.length === 0}
            >
              {familiars.length === 0 && <option value="">No familiars</option>}
              {familiars.map((f) => (
                <option key={f.id} value={f.id}>{f.display_name ?? f.name ?? f.id}</option>
              ))}
            </select>
            <button
              type="button"
              className="library-research-run"
              onClick={() => void start()}
              disabled={running || topic.trim().length < 3}
            >
              <Icon name="ph:magnifying-glass" width={14} />
              <span>{running ? "Researching…" : "Run research"}</span>
            </button>
          </div>

          {run.phase === "running" && (
            <div className="library-research-status">
              <span className="library-research-spinner" aria-hidden />
              <span>{run.status}</span>
            </div>
          )}
          {run.phase === "error" && (
            <div className="library-research-status library-research-status--error">
              <Icon name="ph:warning" width={14} />
              <span>{run.error}</span>
            </div>
          )}
          {run.phase === "idle" && (
            <p className="library-research-hint">
              The familiar researches the topic and saves a cited brief to your Library’s Research
              collection. ⌘↵ to run.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

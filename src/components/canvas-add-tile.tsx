"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  buildSketchPrompt,
  type CanvasArtifact,
} from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import { generateArtifactCode } from "@/lib/canvas-generate";
import {
  INITIAL_ADD_TILE_STATE,
  addTileReducer,
  buildAddArtifact,
  derivePastedTitle,
  detectPastedKind,
  type AddTileMode,
} from "@/lib/canvas-add";
import { useAnnouncer } from "@/components/ui/live-region";

// The Canvas gallery's in-grid composer (cave-fema): a ghost tile that
// expands in place. Describe streams a sketch from a familiar (same client
// chat bridge as the inline viewer); Paste/Blank take code directly. Saving
// is always explicit — nothing hits /api/canvas until Keep / Add to Canvas.

const MODES: { id: AddTileMode; label: string }[] = [
  { id: "describe", label: "Describe" },
  { id: "paste", label: "Paste code" },
  { id: "blank", label: "Blank" },
];

export function CanvasAddTile({ familiarId, hero = false, onSaved }: {
  familiarId: string | null;
  /** Hero form fills the empty gallery; grid form is the first tile. */
  hero?: boolean;
  onSaved: (artifacts: CanvasArtifact[], savedId: string) => void;
}) {
  const [state, dispatch] = useReducer(addTileReducer, INITIAL_ADD_TILE_STATE);
  const [chosenFamiliar, setChosenFamiliar] = useState<string | null>(null);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [streamChars, setStreamChars] = useState(0);
  const [refineText, setRefineText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  const abortRef = useRef<AbortController | null>(null);
  const ghostRef = useRef<HTMLButtonElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const refineInputRef = useRef<HTMLInputElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  // What Retry re-runs: the last generation request, verbatim.
  const lastRunRef = useRef<{ prompt: string } | null>(null);

  const activeFamiliar = chosenFamiliar ?? familiarId;
  const expanded = state.phase !== "collapsed";

  // Abort any in-flight generation on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Lazy familiar roster for the switcher — one attempt per mount (a failed
  // or empty roster must not re-fetch on every expand; the switcher then
  // simply shows the active familiar).
  const rosterFetchedRef = useRef(false);
  useEffect(() => {
    if (!expanded || rosterFetchedRef.current) return;
    rosterFetchedRef.current = true;
    const ctrl = new AbortController();
    void fetch("/api/familiars", { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { familiars?: Familiar[] } | null) => {
        if (data?.familiars) setFamiliars(data.familiars);
      })
      .catch(() => {
        // An abort (quick expand -> collapse) must not consume the single
        // attempt — the next expand should try again. Real failures keep the
        // latch; the switcher then just shows the active familiar.
        if (ctrl.signal.aborted) rosterFetchedRef.current = false;
      })
    return () => ctrl.abort();
  }, [expanded, familiars.length]);

  // Focus follows phase TRANSITIONS: expand -> input; a real collapse -> back
  // to the ghost; generating/result/error -> their primary control (the
  // previous element unmounts, and focus must not fall to document.body).
  // Keyed off the previous phase so the initial mount never steals focus.
  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (prev === state.phase) return; // mount, or a non-phase re-render
    switch (state.phase) {
      case "composing":
        (state.mode === "describe" ? promptRef.current : editorRef.current)?.focus();
        break;
      case "collapsed":
        ghostRef.current?.focus();
        break;
      case "generating":
        cancelRef.current?.focus();
        break;
      case "result":
        refineInputRef.current?.focus();
        break;
      case "error":
        retryRef.current?.focus();
        break;
    }
  }, [state.phase, state.mode]);

  // Switching modes while composing swaps the input element — follow it.
  useEffect(() => {
    if (state.phase !== "composing") return;
    (state.mode === "describe" ? promptRef.current : editorRef.current)?.focus();
  }, [state.mode, state.phase]);

  const collapse = useCallback(() => {
    abortRef.current?.abort();
    setStreamChars(0);
    setSaveError(null);
    dispatch({ type: "collapse" });
  }, []);

  const runGeneration = useCallback(async (prompt: string) => {
    if (!activeFamiliar) return;
    lastRunRef.current = { prompt };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreamChars(0);
    const result = await generateArtifactCode({
      prompt,
      familiarId: activeFamiliar,
      signal: ctrl.signal,
      onText: (t) => setStreamChars(t.length),
    });
    if (ctrl.signal.aborted) return; // collapse/discard already handled state
    if (result.code && result.kind && !result.error) {
      dispatch({ type: "generated", code: result.code, kind: result.kind });
      announce("Sketch ready — Keep, Refine, or Discard.");
    } else {
      dispatch({ type: "generation-failed", message: result.error ?? "Generation failed." });
      announce("Sketch generation failed.");
    }
  }, [activeFamiliar, announce]);

  const conjure = useCallback(() => {
    if (state.phase !== "composing" || !state.prompt.trim() || !activeFamiliar) return;
    dispatch({ type: "generate" });
    void runGeneration(buildSketchPrompt(state.prompt));
  }, [state.phase, state.prompt, activeFamiliar, runGeneration]);

  const refine = useCallback(() => {
    const ask = refineText.trim();
    // Guard BEFORE dispatching: entering "generating" with no familiar to run
    // would wedge the spinner with no terminal event (mirrors conjure).
    if (state.phase !== "result" || !state.result || !ask || !activeFamiliar) return;
    dispatch({ type: "refine" });
    setRefineText("");
    void runGeneration(buildRefinePrompt(state.result.code, ask, state.result.kind));
  }, [state.phase, state.result, refineText, activeFamiliar, runGeneration]);

  const retry = useCallback(() => {
    if (state.phase !== "error" || !lastRunRef.current || !activeFamiliar) return;
    dispatch({ type: "retry" });
    void runGeneration(lastRunRef.current.prompt);
  }, [state.phase, activeFamiliar, runGeneration]);

  const save = useCallback(async (code: string, kind: "html" | "react") => {
    const artifact = buildAddArtifact({
      id: `art-${crypto.randomUUID()}`,
      now: new Date().toISOString(),
      mode: state.mode,
      prompt: state.prompt,
      pastedTitle: state.pastedTitle,
      code,
      kind,
    });
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { artifacts?: CanvasArtifact[]; savedId?: string };
      announce(`Saved '${artifact.title}' to Canvas.`);
      dispatch({ type: "saved" });
      setRefineText("");
      // The store content-dedupes: re-keeping an unchanged sketch settles into
      // the existing record's id, so highlight where the save actually landed.
      onSaved(data.artifacts ?? [], data.savedId ?? artifact.id);
    } catch {
      setSaveError("Couldn't save to the Canvas — try again.");
    } finally {
      setSaving(false);
    }
  }, [state.mode, state.prompt, state.pastedTitle, announce, onSaved]);

  // ── Collapsed: the ghost tile ──────────────────────────────────────────────
  // Both tile forms live inside the gallery's role="list" grid — wrap them in
  // a listitem (display: contents keeps the grid track on the tile itself) so
  // list semantics stay valid for AT alongside the sketch cards.
  if (!expanded) {
    return (
      <div role="listitem" className="chat-canvas-add__li">
        <button
          ref={ghostRef}
          type="button"
          className={`chat-canvas-add chat-canvas-add--ghost focus-ring${hero ? " chat-canvas-add--hero" : ""}`}
          aria-expanded={false}
          onClick={() => dispatch({ type: "expand" })}
        >
          <Icon name="ph:plus-bold" aria-hidden />
          New sketch
        </button>
      </div>
    );
  }

  const pastedKind = detectPastedKind(state.pastedCode);
  const previewSrc = state.result
    ? state.result.kind === "react"
      ? buildReactSrcDoc(state.result.code)
      : buildPreviewSrcDoc(state.result.code)
    : null;

  return (
    <div role="listitem" className="chat-canvas-add__li">
    <section
      className={`chat-canvas-add chat-canvas-add--expanded${hero ? " chat-canvas-add--hero" : ""}`}
      aria-label="New sketch"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); collapse(); }
      }}
    >
      <div className="chat-canvas-add__head">
        <div className="chat-canvas-add__modes" role="group" aria-label="How to add">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chat-canvas-add__mode focus-ring"
              aria-pressed={state.mode === m.id}
              disabled={state.phase === "generating"}
              onClick={() => dispatch({ type: "set-mode", mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="chat-canvas-add__close focus-ring"
          aria-label="Close composer"
          onClick={collapse}
        >
          <Icon name="ph:x" aria-hidden />
        </button>
      </div>

      {state.phase === "generating" ? (
        <>
          <div className="chat-canvas-add__skeleton" aria-hidden />
          {/* The stable sentence is the live region; the fast-ticking char
              count is visual-only so SRs don't re-announce every chunk. */}
          <div className="chat-canvas-add__status">
            <Icon name="ph:sparkle" aria-hidden />
            <span role="status">
              {familiars.find((f) => f.id === activeFamiliar)?.display_name ?? "Familiar"} is sketching…
            </span>
            <span aria-hidden>{streamChars > 0 ? ` ${(streamChars / 1000).toFixed(1)}k chars` : ""}</span>
          </div>
          <div className="chat-canvas-add__row">
            <span className="chat-canvas-add__spacer" />
            <button ref={cancelRef} type="button" className="chat-canvas-add__ghost-btn focus-ring" onClick={collapse}>
              Cancel
            </button>
          </div>
        </>
      ) : state.phase === "error" ? (
        <>
          <div className="chat-canvas-add__error" role="alert">{state.error}</div>
          <div className="chat-canvas-add__row">
            <span className="chat-canvas-add__spacer" />
            <button type="button" className="chat-canvas-add__ghost-btn focus-ring" onClick={() => dispatch({ type: "discard-result" })}>
              Back
            </button>
            <button type="button" className="chat-canvas-add__go focus-ring" ref={retryRef} onClick={retry}>
              Retry
            </button>
          </div>
        </>
      ) : state.phase === "result" && state.result ? (
        <>
          <div className="chat-canvas-add__preview">
            <iframe
              title="Generated sketch preview"
              sandbox="allow-scripts"
              srcDoc={previewSrc ?? ""}
              tabIndex={-1}
            />
          </div>
          <input
            ref={refineInputRef}
            className="chat-canvas-add__refine-input focus-ring"
            aria-label="Refine the sketch"
            placeholder="Refine it — e.g. make the header sticky…"
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && refineText.trim() && !saving) { e.preventDefault(); refine(); }
            }}
          />
          {saveError ? <div className="chat-canvas-add__error" role="alert">{saveError}</div> : null}
          <div className="chat-canvas-add__row">
            <button type="button" className="chat-canvas-add__ghost-btn focus-ring" disabled={saving} onClick={() => dispatch({ type: "discard-result" })}>
              Discard
            </button>
            <span className="chat-canvas-add__spacer" />
            <button
              type="button"
              className="chat-canvas-add__ghost-btn focus-ring"
              disabled={!refineText.trim() || saving}
              onClick={refine}
            >
              Refine
            </button>
            <button
              type="button"
              className="chat-canvas-add__go focus-ring"
              disabled={saving}
              onClick={() => void save(state.result!.code, state.result!.kind)}
            >
              <Icon name="ph:check-bold" aria-hidden />
              Keep
            </button>
          </div>
        </>
      ) : state.mode === "describe" ? (
        <>
          <textarea
            ref={promptRef}
            className="chat-canvas-add__prompt focus-ring"
            aria-label="Describe the sketch to generate"
            placeholder="Describe a sketch — e.g. a pricing page with three tiers, dark theme…"
            value={state.prompt}
            onChange={(e) => dispatch({ type: "set-prompt", prompt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); conjure(); }
            }}
          />
          <div className="chat-canvas-add__row">
            <select
              className="chat-canvas-add__familiar focus-ring"
              aria-label="Familiar to generate with"
              value={activeFamiliar ?? ""}
              onChange={(e) => setChosenFamiliar(e.target.value || null)}
            >
              {activeFamiliar && !familiars.some((f) => f.id === activeFamiliar) ? (
                <option value={activeFamiliar}>{activeFamiliar}</option>
              ) : null}
              {familiars.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.emoji ? `${f.emoji} ` : ""}{f.display_name}
                </option>
              ))}
            </select>
            <span className="chat-canvas-add__spacer" />
            <button
              type="button"
              className="chat-canvas-add__go focus-ring"
              disabled={!state.prompt.trim() || !activeFamiliar}
              title={activeFamiliar ? "Generate (⌘↵)" : "Pick a familiar first"}
              onClick={conjure}
            >
              <Icon name="ph:sparkle" aria-hidden />
              Conjure
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            ref={editorRef}
            className="chat-canvas-add__editor focus-ring"
            aria-label="Sketch code"
            spellCheck={false}
            placeholder="Paste a self-contained HTML document or a React component…"
            value={state.pastedCode}
            onChange={(e) => dispatch({ type: "set-pasted-code", code: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && state.pastedCode.trim() && !saving) {
                e.preventDefault();
                void save(state.pastedCode, pastedKind);
              }
            }}
          />
          {saveError ? <div className="chat-canvas-add__error" role="alert">{saveError}</div> : null}
          <div className="chat-canvas-add__row">
            <input
              className="chat-canvas-add__title focus-ring"
              aria-label="Sketch title"
              placeholder={derivePastedTitle(state.pastedCode)}
              value={state.pastedTitle}
              onChange={(e) => dispatch({ type: "set-pasted-title", title: e.target.value })}
            />
            <span className="chat-canvas-add__kind" title="Detected from the code">
              {pastedKind === "react" ? "React" : "HTML"}
            </span>
            <button
              type="button"
              className="chat-canvas-add__go focus-ring"
              disabled={!state.pastedCode.trim() || saving}
              onClick={() => void save(state.pastedCode, pastedKind)}
            >
              <Icon name="ph:check-bold" aria-hidden />
              Add to Canvas
            </button>
          </div>
        </>
      )}
    </section>
    </div>
  );
}

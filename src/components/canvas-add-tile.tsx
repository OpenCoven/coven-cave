"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  buildSketchPrompt,
  titleFromPrompt,
  type CanvasArtifact,
} from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import {
  INITIAL_ADD_TILE_STATE,
  addTileReducer,
  buildAddArtifact,
  derivePastedTitle,
  detectPastedKind,
  focusTargetForState,
  generationStatusText,
  type AddTileMode,
} from "@/lib/canvas-add";
import {
  consumeCanvasGeneration,
  getCanvasGenerationSnapshot,
  retryCanvasGenerationSave,
  startCanvasGeneration,
  stopCanvasGeneration,
  subscribeCanvasGeneration,
  type CanvasGenerationSnapshot,
} from "@/lib/canvas-generation-registry";
import { DEFAULT_REFINE_SUGGESTIONS, generateRefineSuggestions } from "@/lib/refine-suggestions";
import { useAnnouncer } from "@/components/ui/live-region";
import { Popover, PopoverBody, PopoverItem } from "@/components/ui/popover";
import { Tabs } from "@/components/ui/tabs";

const CREATE_SUGGESTIONS = [
  "A pricing page with three plans",
  "A mobile dashboard for tracking habits",
  "A settings panel with dark mode",
] as const;

type ResultTab = "canvas" | "code";

export function CanvasAddTile({
  familiarId,
  hero = false,
  expandRequest,
  onArtifactsChanged,
  onActiveArtifactChange,
}: {
  familiarId: string | null;
  hero?: boolean;
  /** Bump to a new nonzero value to expand the collapsed tile (the toolbar's
   *  "New sketch" button). An already-open composer is left untouched. */
  expandRequest?: number;
  onArtifactsChanged: (artifacts: CanvasArtifact[], changedId: string) => void;
  onActiveArtifactChange: (id: string | null) => void;
}) {
  const [state, dispatch] = useReducer(addTileReducer, INITIAL_ADD_TILE_STATE);
  const [chosenFamiliar, setChosenFamiliar] = useState<string | null>(null);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [refineText, setRefineText] = useState("");
  const [resultTab, setResultTab] = useState<ResultTab>("canvas");
  const [codeMenuOpen, setCodeMenuOpen] = useState(false);
  const [codeSaving, setCodeSaving] = useState(false);
  const [codeSaveError, setCodeSaveError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [hiddenRunId, setHiddenRunId] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  const generation = useSyncExternalStore(
    subscribeCanvasGeneration,
    getCanvasGenerationSnapshot,
    getCanvasGenerationSnapshot,
  );
  const ownedRunsRef = useRef(new Map<string, number>());
  const ghostRef = useRef<HTMLButtonElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const stopRef = useRef<HTMLButtonElement | null>(null);
  const refineInputRef = useRef<HTMLTextAreaElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const codeMenuRef = useRef<HTMLButtonElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  const activeFamiliar = chosenFamiliar ?? familiarId;
  const generationVisible = generation.runId !== null && generation.runId !== hiddenRunId;
  const expanded = state.phase !== "collapsed" || generationVisible;

  // The artifact being actively created is rendered by this tile. Hide its
  // gallery card until the flow closes so autosave never creates a duplicate.
  useEffect(() => {
    const activeId = expanded && state.result ? state.identity?.id ?? null : null;
    onActiveArtifactChange(activeId);
    return () => onActiveArtifactChange(null);
  }, [expanded, state.identity?.id, state.result, onActiveArtifactChange]);

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
        if (ctrl.signal.aborted) rosterFetchedRef.current = false;
      });
    return () => ctrl.abort();
  }, [expanded]);

  // Toolbar-driven expand: same action as clicking the ghost tile. The
  // composing focus effect scrolls a freshly-expanded tile into view (focus
  // implies scroll); an already-open tile just gets scrolled to.
  const expandHandledRef = useRef(0);
  useEffect(() => {
    if (!expandRequest || expandRequest === expandHandledRef.current) return;
    expandHandledRef.current = expandRequest;
    if (state.phase === "collapsed" && !generationVisible) {
      dispatch({ type: "expand" });
      return;
    }
    (sectionRef.current ?? ghostRef.current)?.scrollIntoView({ block: "nearest" });
  }, [expandRequest, state.phase, generationVisible]);

  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    const target = focusTargetForState(state, prev);
    if (target === "prompt") promptRef.current?.focus();
    if (target === "editor") editorRef.current?.focus();
    if (target === "ghost") ghostRef.current?.focus();
    if (target === "cancel") stopRef.current?.focus();
    if (target === "refine") refineInputRef.current?.focus();
    if (target === "retry") retryRef.current?.focus();
  }, [state.phase, state.mode]);

  useEffect(() => {
    if (state.phase !== "composing") return;
    (state.mode === "describe" ? promptRef.current : editorRef.current)?.focus();
  }, [state.mode, state.phase]);

  const previewSrc = useMemo(() => {
    if (!state.result) return "";
    return state.result.kind === "react"
      ? buildReactSrcDoc(state.result.code)
      : buildPreviewSrcDoc(state.result.code);
  }, [state.result]);

  useEffect(() => {
    setRuntimeError(null);
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === "sandbox-error" && typeof event.data.message === "string") {
        setRuntimeError(event.data.message);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewSrc]);

  const handledTerminalRunRef = useRef<string | null>(null);
  const handledSaveFailureRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      generation.phase !== "complete" ||
      !generation.runId ||
      !generation.artifact ||
      !generation.artifacts ||
      !generation.savedId ||
      handledTerminalRunRef.current === generation.runId
    ) return;
    handledTerminalRunRef.current = generation.runId;
    onArtifactsChanged([...generation.artifacts], generation.savedId);
    const revision = ownedRunsRef.current.get(generation.runId);
    if (revision !== undefined) {
      dispatch({
        type: "generated",
        runId: generation.runId,
        code: generation.artifact.code,
        kind: generation.artifact.kind ?? "html",
        sessionId: generation.sessionId,
        revision,
      });
      const savedCreatedAt = generation.artifacts.find((entry) => entry.id === generation.savedId)?.createdAt;
      dispatch({
        type: "save-succeeded",
        revision,
        savedId: generation.savedId,
        savedCreatedAt,
        savedUpdatedAt: generation.artifact.updatedAt,
      });
      setResultTab("canvas");
      setRefineText("");
      ownedRunsRef.current.delete(generation.runId);
    } else {
      dispatch({ type: "collapse" });
    }
    announce(`Saved '${generation.artifact.title}' to Canvas.`);
    consumeCanvasGeneration(generation.runId);
  }, [announce, generation, onArtifactsChanged]);

  useEffect(() => {
    if (
      generation.phase !== "error"
      || !generation.saveFailure
      || !generation.runId
      || !generation.artifact
      || handledSaveFailureRunRef.current === generation.runId
    ) return;
    const revision = ownedRunsRef.current.get(generation.runId);
    if (revision === undefined) return;
    handledSaveFailureRunRef.current = generation.runId;
    dispatch({
      type: "generated",
      runId: generation.runId,
      code: generation.artifact.code,
      kind: generation.artifact.kind ?? "html",
      sessionId: generation.sessionId,
      revision,
    });
    dispatch({ type: "save-failed", revision });
  }, [generation]);

  const createPreview = useCallback(() => {
    if (!state.prompt.trim() || !activeFamiliar) return;
    const runId = crypto.randomUUID();
    const identity = state.identity ?? {
      id: `art-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    const revision = state.revision + 1;
    const started = startCanvasGeneration({
      runId,
      identity,
      familiarId: activeFamiliar,
      purpose: "create",
      prompt: state.prompt,
      title: titleFromPrompt(state.prompt),
      generationPrompt: buildSketchPrompt(state.prompt),
      originalIntent: state.prompt,
    });
    if (started.runId !== runId) return;
    ownedRunsRef.current.set(runId, revision);
    setHiddenRunId(null);
    dispatch({ type: "begin-generation", runId, identity });
  }, [activeFamiliar, state.identity, state.prompt, state.revision]);

  const refine = useCallback(() => {
    const ask = refineText.trim();
    if (!ask || !activeFamiliar || !state.result || !state.identity || state.phase !== "result") return;
    const runId = crypto.randomUUID();
    const revision = state.revision + 1;
    const started = startCanvasGeneration({
      runId,
      identity: state.identity,
      familiarId: activeFamiliar,
      purpose: "refine",
      prompt: state.prompt,
      title: titleFromPrompt(state.prompt),
      generationPrompt: buildRefinePrompt(state.result.code, ask, state.result.kind),
      originalIntent: ask,
      expectedKind: state.result.kind,
      expectedUpdatedAt: state.persistedUpdatedAt ?? undefined,
      sessionId: state.result.sessionId,
    });
    if (started.runId !== runId) return;
    ownedRunsRef.current.set(runId, revision);
    setHiddenRunId(null);
    dispatch({ type: "begin-refine", runId });
  }, [
    activeFamiliar,
    refineText,
    state.identity,
    state.persistedUpdatedAt,
    state.phase,
    state.prompt,
    state.result,
    state.revision,
  ]);

  const stop = useCallback(() => {
    if (!generation.runId || !stopCanvasGeneration(generation.runId)) return;
    ownedRunsRef.current.delete(generation.runId);
    announce("Preview creation cancelled.");
  }, [announce, generation.runId]);

  const collapse = useCallback(() => {
    if (generation.runId) setHiddenRunId(generation.runId);
    setCodeMenuOpen(false);
    dispatch({ type: "collapse" });
  }, [generation.runId]);

  const retryGeneration = useCallback((failed: CanvasGenerationSnapshot) => {
    if (!failed.runId || !failed.identity || !failed.familiarId) return;
    const previousRunId = failed.runId;
    dispatch({
      type: "generation-failed",
      runId: previousRunId,
      message: failed.error ?? "Preview creation cancelled.",
      kind: "generation",
    });
    if (!consumeCanvasGeneration(previousRunId)) return;
    const runId = crypto.randomUUID();
    const revision = state.revision + 1;
    const started = startCanvasGeneration({
      runId,
      identity: { ...failed.identity },
      familiarId: failed.familiarId,
      purpose: failed.purpose ?? "create",
      prompt: failed.prompt,
      title: failed.title,
      generationPrompt: failed.generationPrompt,
      originalIntent: failed.originalIntent,
      expectedKind: failed.expectedKind ?? undefined,
      expectedUpdatedAt: failed.expectedUpdatedAt ?? undefined,
      sessionId: failed.sessionId,
    });
    if (started.runId !== runId) return;
    setHiddenRunId(null);
    if (failed.purpose === "refine" && state.result && state.identity) {
      ownedRunsRef.current.set(runId, revision);
      dispatch({ type: "begin-refine", runId });
    } else if (state.prompt.trim()) {
      ownedRunsRef.current.set(runId, revision);
      dispatch({ type: "begin-generation", runId, identity: { ...failed.identity } });
    }
  }, [state.identity, state.prompt, state.result, state.revision]);

  const retrySave = useCallback((failed: CanvasGenerationSnapshot) => {
    if (!failed.runId || failed.saveFailure !== "ambiguous") return;
    if (retryCanvasGenerationSave(failed.runId)) {
      announce("Retrying the same preview save.");
    }
  }, [announce]);

  const dismissGeneration = useCallback(() => {
    if (!generation.runId) return;
    dispatch({
      type: "generation-failed",
      runId: generation.runId,
      message: generation.error ?? "Preview creation cancelled.",
      kind: "generation",
    });
    consumeCanvasGeneration(generation.runId);
    dispatch({ type: "collapse" });
  }, [generation.error, generation.runId]);

  const discard = useCallback(async () => {
    if (!state.identity || !state.result) return;
    // Every valid generated result starts an autosave. Even when the client
    // observed a failure, the server may have committed before the response
    // was lost, so DELETE the stable id idempotently instead of assuming the
    // record never reached disk.
    setDiscarding(true);
    try {
      const response = await fetch("/api/canvas", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: state.identity.id }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { artifacts?: CanvasArtifact[] };
      onArtifactsChanged(data.artifacts ?? [], state.identity.id);
      dispatch({ type: "discard-local" });
      announce("Preview discarded from Canvas.");
    } catch {
      dispatch({ type: "discard-failed", message: "Couldn’t discard this preview. Try again." });
      announce("Couldn’t discard this preview.", "assertive");
    } finally {
      setDiscarding(false);
    }
  }, [announce, onArtifactsChanged, state.identity, state.result]);

  const saveCode = useCallback(async () => {
    if (!state.pastedCode.trim() || codeSaving) return;
    const kind = detectPastedKind(state.pastedCode);
    const artifact = buildAddArtifact({
      id: `art-${crypto.randomUUID()}`,
      now: new Date().toISOString(),
      mode: state.mode,
      prompt: "",
      pastedTitle: state.pastedTitle,
      code: state.pastedCode,
      kind,
    });
    setCodeSaving(true);
    setCodeSaveError(null);
    try {
      const response = await fetch("/api/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { artifacts?: CanvasArtifact[] };
      onArtifactsChanged(data.artifacts ?? [], artifact.id);
      dispatch({ type: "code-saved" });
      announce(`Saved '${artifact.title}' to Canvas.`);
    } catch {
      setCodeSaveError("Couldn’t save this code to Canvas. Try again.");
      announce("Couldn’t save this code to Canvas.", "assertive");
    } finally {
      setCodeSaving(false);
    }
  }, [announce, codeSaving, onArtifactsChanged, state.mode, state.pastedCode, state.pastedTitle]);

  const chooseCodeMode = useCallback((mode: AddTileMode) => {
    setCodeMenuOpen(false);
    dispatch({ type: "set-mode", mode });
  }, []);

  if (!expanded) {
    return (
      <div role="listitem" className="chat-canvas-add__li">
        <button
          ref={ghostRef}
          type="button"
          className={`chat-canvas-add chat-canvas-add--ghost focus-ring${hero ? " chat-canvas-add--hero" : ""}`}
          aria-expanded={false}
          onClick={() => {
            if (generation.runId) setHiddenRunId(null);
            else dispatch({ type: "expand" });
          }}
        >
          <Icon name="ph:plus-bold" aria-hidden />
          New sketch
        </button>
      </div>
    );
  }

  const pastedKind = detectPastedKind(state.pastedCode);
  const refineSuggestions = state.result
    ? [...DEFAULT_REFINE_SUGGESTIONS.slice(0, 2), ...generateRefineSuggestions(state.result.code, state.result.kind, 2)]
    : [];
  const busy = generationVisible && (
    generation.phase === "generating" ||
    generation.phase === "repairing" ||
    generation.phase === "saving"
  );
  const canStopGeneration = generation.phase === "generating" || generation.phase === "repairing";
  const generationFailed = generationVisible && (
    generation.phase === "error" ||
    generation.phase === "cancelled"
  );

  return (
    <div role="listitem" className="chat-canvas-add__li">
      <section
        ref={sectionRef}
        className={`chat-canvas-add chat-canvas-add--expanded${hero ? " chat-canvas-add--hero" : ""}`}
        aria-label="New sketch"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !codeMenuOpen) {
            event.preventDefault();
            collapse();
          }
        }}
      >
        <div className="chat-canvas-add__head">
          <div>
            <h2 className="chat-canvas-add__heading">
              {state.phase === "result" && !generationVisible ? "Your preview" : "What would you like to create?"}
            </h2>
            {state.phase === "composing" && state.mode === "describe" ? (
              <p className="chat-canvas-add__subheading">Describe a screen, component, or interaction.</p>
            ) : null}
          </div>
          <span className="chat-canvas-add__spacer" />
          <button type="button" className="chat-canvas-add__close focus-ring" aria-label="Close composer" onClick={collapse}>
            <Icon name="ph:x" aria-hidden />
          </button>
        </div>

        {busy ? (
          <>
            <div className="chat-canvas-add__skeleton" aria-hidden />
            <div className="chat-canvas-add__status">
              <Icon name="ph:sparkle" aria-hidden />
              <span role="status">
                {generation.phase === "saving"
                  ? "Saving your preview to Canvas…"
                  : generationStatusText(
                      generation.phase === "repairing" ? "repairing" : "generating",
                      familiars.find((f) => f.id === generation.familiarId)?.display_name ?? "Familiar",
                    )}
              </span>
              <span aria-hidden>{generation.streamChars > 0 ? ` ${(generation.streamChars / 1000).toFixed(1)}k chars` : ""}</span>
            </div>
            <div className="chat-canvas-add__row">
              <span className="chat-canvas-add__spacer" />
              {canStopGeneration ? (
                <button ref={stopRef} type="button" className="chat-canvas-add__ghost-btn focus-ring" onClick={stop}>Stop</button>
              ) : null}
            </div>
          </>
        ) : generationFailed ? (
          <>
            {generation.artifact ? (
              <div className="chat-canvas-add__preview">
                <iframe
                  title="Generated sketch preview"
                  sandbox="allow-scripts"
                  srcDoc={generation.artifact.kind === "react"
                    ? buildReactSrcDoc(generation.artifact.code)
                    : buildPreviewSrcDoc(generation.artifact.code)}
                />
              </div>
            ) : null}
            <div className="chat-canvas-add__error" role="alert">
              {generation.phase === "cancelled"
                ? "Preview creation stopped."
                : generation.error ?? "We couldn’t create that preview. Try again."}
            </div>
            {generation.originalIntent ? (
              <p className="chat-canvas-add__subheading">Request: {generation.originalIntent}</p>
            ) : null}
            <div className="chat-canvas-add__row">
              <button type="button" className="chat-canvas-add__ghost-btn focus-ring" onClick={dismissGeneration}>
                Dismiss
              </button>
              <span className="chat-canvas-add__spacer" />
              {generation.saveFailure === "ambiguous" ? (
                <button
                  ref={retryRef}
                  type="button"
                  className="chat-canvas-add__go focus-ring"
                  onClick={() => retrySave(generation)}
                >
                  Retry save
                </button>
              ) : generation.artifact ? null : (
                <button
                  ref={retryRef}
                  type="button"
                  className="chat-canvas-add__go focus-ring"
                  onClick={() => retryGeneration(generation)}
                >
                  Try again
                </button>
              )}
            </div>
          </>
        ) : state.phase === "error" ? (
          <>
            <div className="chat-canvas-add__error" role="alert">{state.error}</div>
            <div className="chat-canvas-add__row">
              <button type="button" className="chat-canvas-add__ghost-btn focus-ring" onClick={() => dispatch({ type: "edit-description" })}>
                Edit description
              </button>
              <span className="chat-canvas-add__spacer" />
              <button ref={retryRef} type="button" className="chat-canvas-add__go focus-ring" disabled={!activeFamiliar} onClick={createPreview}>
                Try again
              </button>
            </div>
          </>
        ) : state.phase === "result" && state.result ? (
          <>
            <div className="chat-canvas-add__result-head">
              <Tabs<ResultTab>
                variant="segment"
                size="sm"
                ariaLabel="Preview result"
                value={resultTab}
                onChange={setResultTab}
                items={[
                  { id: "canvas", label: "Preview", icon: "ph:squares-four" },
                  { id: "code", label: "Code", icon: "ph:code" },
                ]}
              />
              <span className={`chat-canvas-add__save-state chat-canvas-add__save-state--${state.saveState}`} aria-live="polite">
                {state.saveState === "saving" ? "Saving…" : state.saveState === "saved" ? "Saved" : "Not saved"}
              </span>
            </div>
            {resultTab === "canvas" ? (
              <div className="chat-canvas-add__preview">
                <iframe
                  ref={frameRef}
                  title="Generated sketch preview"
                  sandbox="allow-scripts"
                  srcDoc={previewSrc}
                />
                {runtimeError ? <div className="chat-canvas-add__runtime-error" role="alert">{runtimeError}</div> : null}
              </div>
            ) : (
              <pre className="chat-canvas-add__code"><code>{state.result.code}</code></pre>
            )}
            {state.error ? <div className="chat-canvas-add__error" role="alert">{state.error}</div> : null}
            <label className="chat-canvas-add__refine-label" htmlFor="canvas-add-refine">Describe a change</label>
            <textarea
              id="canvas-add-refine"
              ref={refineInputRef}
              className="chat-canvas-add__refine-input focus-ring"
              placeholder="Make it mobile-friendly, add an empty state…"
              value={refineText}
              onChange={(event) => setRefineText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  refine();
                }
              }}
            />
            {codeSaveError ? <div className="chat-canvas-add__error" role="alert">{codeSaveError}</div> : null}
            <div className="chat-canvas-add__suggestions" aria-label="Suggested changes">
              {refineSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="chat-canvas-add__suggestion focus-ring"
                  aria-label={`Use suggested change: ${suggestion}`}
                  onClick={() => {
                    setRefineText(suggestion);
                    announce(`Suggested change added: ${suggestion}`);
                    requestAnimationFrame(() => refineInputRef.current?.focus());
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <div className="chat-canvas-add__row">
              <button type="button" className="chat-canvas-add__ghost-btn focus-ring" disabled={discarding || state.saveState === "saving"} onClick={() => void discard()}>
                {discarding ? "Discarding…" : "Discard"}
              </button>
              <span className="chat-canvas-add__spacer" />
              <button
                type="button"
                className="chat-canvas-add__go focus-ring"
                disabled={!refineText.trim() || !activeFamiliar || state.saveState === "saving"}
                title={activeFamiliar ? "Refine preview (⌘↵)" : "Choose a familiar first"}
                onClick={refine}
              >
                <Icon name="ph:sparkle" aria-hidden /> Refine preview
              </button>
            </div>
          </>
        ) : state.mode === "describe" ? (
          <>
            <textarea
              ref={promptRef}
              className="chat-canvas-add__prompt focus-ring"
              aria-label="What would you like to create?"
              placeholder="Describe a screen, component, or interaction…"
              value={state.prompt}
              onChange={(event) => dispatch({ type: "set-prompt", prompt: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  createPreview();
                }
              }}
            />
            {hero ? (
              <div className="chat-canvas-add__suggestions" aria-label="Starting suggestions">
                {CREATE_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chat-canvas-add__suggestion focus-ring"
                    aria-label={`Use starting suggestion: ${suggestion}`}
                    onClick={() => {
                      dispatch({ type: "set-prompt", prompt: suggestion });
                      announce(`Description added: ${suggestion}`);
                      requestAnimationFrame(() => promptRef.current?.focus());
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="chat-canvas-add__row">
              <select
                className="chat-canvas-add__familiar focus-ring"
                aria-label="Familiar to create with"
                value={activeFamiliar ?? ""}
                onChange={(event) => setChosenFamiliar(event.target.value || null)}
              >
                {!activeFamiliar ? <option value="">Choose a familiar</option> : null}
                {activeFamiliar && !familiars.some((f) => f.id === activeFamiliar) ? <option value={activeFamiliar}>{activeFamiliar}</option> : null}
                {familiars.map((familiar) => (
                  <option key={familiar.id} value={familiar.id}>{familiar.emoji ? `${familiar.emoji} ` : ""}{familiar.display_name}</option>
                ))}
              </select>
              <button
                ref={codeMenuRef}
                type="button"
                className="chat-canvas-add__start-code focus-ring"
                aria-haspopup="menu"
                aria-expanded={codeMenuOpen}
                onClick={() => setCodeMenuOpen((open) => !open)}
              >
                Start from code <Icon name="ph:caret-down" aria-hidden />
              </button>
              <Popover open={codeMenuOpen} onOpenChange={setCodeMenuOpen} anchorRef={codeMenuRef} placement="bottom-start" minWidth={210} ariaLabel="Start from code">
                <PopoverBody role="menu" ariaLabel="Start from code">
                  <PopoverItem onSelect={() => chooseCodeMode("paste")}>Paste code</PopoverItem>
                  <PopoverItem onSelect={() => chooseCodeMode("blank-html")}>Blank HTML</PopoverItem>
                  <PopoverItem onSelect={() => chooseCodeMode("blank-react")}>Blank React component</PopoverItem>
                </PopoverBody>
              </Popover>
              <span className="chat-canvas-add__spacer" />
              <button
                type="button"
                className="chat-canvas-add__go focus-ring"
                disabled={!state.prompt.trim() || !activeFamiliar}
                title={activeFamiliar ? "Create preview (⌘↵)" : "Choose a familiar first"}
                onClick={createPreview}
              >
                <Icon name="ph:sparkle" aria-hidden /> Create preview
              </button>
            </div>
            {!activeFamiliar ? <p className="chat-canvas-add__no-familiar" role="status">Choose a familiar to create a preview.</p> : null}
          </>
        ) : (
          <>
            <div className="chat-canvas-add__code-head">
              <button type="button" className="chat-canvas-add__start-code focus-ring" onClick={() => dispatch({ type: "set-mode", mode: "describe" })}>
                <Icon name="ph:arrow-left" aria-hidden /> Back to description
              </button>
              <span className="chat-canvas-add__kind">{pastedKind === "react" ? "React" : "HTML"}</span>
            </div>
            <textarea
              ref={editorRef}
              className="chat-canvas-add__editor focus-ring"
              aria-label={state.mode === "paste" ? "Paste sketch code" : state.mode === "blank-react" ? "Blank React component" : "Blank HTML document"}
              spellCheck={false}
              placeholder="Paste a self-contained HTML document or React component…"
              value={state.pastedCode}
              onChange={(event) => dispatch({ type: "set-pasted-code", code: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void saveCode();
                }
              }}
            />
            <div className="chat-canvas-add__row">
              <input
                className="chat-canvas-add__title focus-ring"
                aria-label="Sketch title"
                placeholder={derivePastedTitle(state.pastedCode)}
                value={state.pastedTitle}
                onChange={(event) => dispatch({ type: "set-pasted-title", title: event.target.value })}
              />
              <span className="chat-canvas-add__spacer" />
              <button type="button" className="chat-canvas-add__go focus-ring" disabled={!state.pastedCode.trim() || codeSaving} onClick={() => void saveCode()}>
                <Icon name="ph:check-bold" aria-hidden /> {codeSaving ? "Saving…" : "Add to Canvas"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

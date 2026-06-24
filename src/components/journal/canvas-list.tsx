"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { relativeTime } from "@/lib/daily-report";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { DEFAULT_REFINE_SUGGESTIONS, generateRefineSuggestions } from "@/lib/refine-suggestions";
import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  buildSketchPrompt,
  clampArtifactCode,
  titleFromPrompt,
  type CanvasArtifact,
} from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import { generateArtifactCode } from "@/lib/canvas-generate";
import { EmptyState } from "@/components/ui/empty-state";
import type { Familiar } from "@/lib/types";

/**
 * Render children in place, or portaled to <body> when `active`. Used to lift
 * the canvas detail pane into a full-screen overlay that escapes the journal's
 * flex layout (mirrors the chat-artifact fullscreen pattern).
 */
function MaybePortal({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (active && typeof document !== "undefined") return createPortal(children, document.body);
  return <>{children}</>;
}

// Example prompts shown in the empty state so the blank Canvas isn't a dead
// end — tapping one seeds the composer so the user can run or edit it.
const STARTER_SKETCH_PROMPTS: readonly string[] = [
  "A pricing page with three tiers and a highlighted plan",
  "A sign-in form with email, password, and social buttons",
  "A weather dashboard card with an animated icon",
  "A kanban column with draggable task cards",
];

function srcDocFor(art: CanvasArtifact): string {
  return art.kind === "react" ? buildReactSrcDoc(art.code) : buildPreviewSrcDoc(art.code);
}

export function CanvasList({
  familiars,
  activeFamiliarId,
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
}) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [artifacts, setArtifacts] = useState<CanvasArtifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [fullscreen, setFullscreen] = useState(false);
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState("");
  const refineRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState("");
  const [codeDraft, setCodeDraft] = useState("");
  // Transient "Copied" confirmation for the Code tab's copy button.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  // Guards async setState after the tab unmounts — generation is a slow LLM
  // call, so leaving Canvas mid-generate would otherwise setState on a dead tree.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Seed the generate composer from an example prompt and focus it, so the
  // empty-state starters are one tap from a ready-to-run sketch.
  const applyStarter = useCallback((text: string) => {
    setPrompt(text);
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const load = useCallback(async () => {
    if (isDemoModeEnabled()) {
      setArtifacts([]);
      return;
    }
    try {
      const res = await fetch("/api/canvas", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      const list: CanvasArtifact[] = Array.isArray(json.artifacts) ? json.artifacts : [];
      setArtifacts(list);
      setSelectedId((prev) => prev ?? list[list.length - 1]?.id ?? null);
    } catch {
      if (mountedRef.current) setArtifacts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback((art: CanvasArtifact) => {
    void fetch("/api/canvas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifact: art }),
    }).catch(() => undefined);
  }, []);

  const runGeneration = useCallback(
    async (id: string, ask: string, refineOf?: CanvasArtifact) => {
      const familiarId = activeFamiliarId ?? familiars[0]?.id ?? null;
      if (!familiarId) {
        setError("Pick a familiar first — generation runs through it.");
        return;
      }
      setError(null);
      setGenerating((prev) => new Set(prev).add(id));
      const sendPrompt = refineOf
        ? buildRefinePrompt(refineOf.code, ask, refineOf.kind ?? "html")
        : buildSketchPrompt(ask);
      const result = await generateArtifactCode({ prompt: sendPrompt, familiarId });
      if (!mountedRef.current) return;
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (result.error || !result.code) {
        setError(result.error ?? "The familiar didn't return a renderable UI.");
        return;
      }
      const code = clampArtifactCode(result.code);
      setArtifacts((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const next: CanvasArtifact = {
            ...a,
            code,
            kind: result.kind ?? a.kind,
            updatedAt: new Date().toISOString(),
          };
          persist(next);
          return next;
        }),
      );
      setView("preview");
    },
    [activeFamiliarId, familiars, persist],
  );

  const createArtifact = useCallback(
    (ask: string) => {
      const text = ask.trim();
      if (!text) return;
      const id = `art-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const art: CanvasArtifact = {
        id,
        title: titleFromPrompt(text),
        prompt: text,
        code: "",
        kind: "html",
        createdAt: now,
        updatedAt: now,
      };
      setArtifacts((prev) => [...prev, art]);
      setSelectedId(id);
      persist(art);
      void runGeneration(id, text);
    },
    [persist, runGeneration],
  );

  const removeArtifact = useCallback((id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
    void fetch("/api/canvas", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  }, []);

  const startRename = useCallback((artifact: CanvasArtifact) => {
    setSelectedId(artifact.id);
    setEditingTitleId(artifact.id);
    setEditingTitleDraft(artifact.title || "Untitled sketch");
  }, []);

  const cancelRename = useCallback(() => {
    setEditingTitleId(null);
    setEditingTitleDraft("");
  }, []);

  const commitRename = useCallback(
    (id: string) => {
      const title = editingTitleDraft.trim();
      if (!title) {
        cancelRename();
        return;
      }
      setArtifacts((prev) =>
        prev.map((artifact) => {
          if (artifact.id !== id) return artifact;
          if (artifact.title === title) return artifact;
          const next: CanvasArtifact = {
            ...artifact,
            title,
            updatedAt: new Date().toISOString(),
          };
          persist(next);
          return next;
        }),
      );
      setEditingTitleId(null);
      setEditingTitleDraft("");
    },
    [cancelRename, editingTitleDraft, persist],
  );

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const canGenerate = Boolean(activeFamiliarId ?? familiars[0]?.id);
  const selectedBusy = selected ? generating.has(selected.id) : false;
  const codeDirty = Boolean(selected && codeDraft !== selected.code);

  useEffect(() => {
    setCodeDraft(selected?.code ?? "");
  }, [selected?.id, selected?.code]);

  // Escape exits full-screen; deselecting/closing the pane also exits it.
  useEffect(() => {
    if (!fullscreen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!selected) setFullscreen(false);
  }, [selected]);

  // Context-aware refine ideas for the selected sketch (cheap string scan).
  const generatedSuggestions = useMemo(
    () => (selected ? generateRefineSuggestions(selected.code, selected.kind ?? "html") : []),
    [selected],
  );

  // The refine space resets when switching sketches so a draft doesn't leak
  // across artifacts.
  useEffect(() => {
    setRefineOpen(false);
    setRefineText("");
  }, [selectedId]);

  const openRefine = useCallback(() => {
    setRefineOpen(true);
    requestAnimationFrame(() => refineRef.current?.focus());
  }, []);

  const applySuggestion = useCallback((text: string) => {
    setRefineText(text);
    requestAnimationFrame(() => {
      const el = refineRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const submitRefine = useCallback(() => {
    const ask = refineText.trim();
    if (!selected || !ask || generating.has(selected.id)) return;
    void runGeneration(selected.id, ask, selected);
    setRefineText("");
    setRefineOpen(false);
  }, [refineText, selected, generating, runGeneration]);

  function revertCodeEdit() {
    setCodeDraft(selected?.code ?? "");
  }

  function saveCodeEdit() {
    if (!selected || !codeDirty) return;
    const next: CanvasArtifact = {
      ...selected,
      code: clampArtifactCode(codeDraft),
      updatedAt: new Date().toISOString(),
    };
    setArtifacts((prev) => prev.map((artifact) => (artifact.id === next.id ? next : artifact)));
    setCodeDraft(next.code);
    persist(next);
  }

  return (
    <div className="journal-list">
      <aside className="journal-list__rail">
        <form
          className="journal-composer"
          onSubmit={(e) => {
            e.preventDefault();
            createArtifact(prompt);
            setPrompt("");
          }}
        >
          <input
            ref={composerRef}
            className="journal-composer__input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={canGenerate ? "Describe a sketch to generate…" : "Pick a familiar to generate"}
            disabled={!canGenerate}
            aria-label="Describe a sketch to generate"
          />
          <button type="submit" className="journal-composer__btn" disabled={!canGenerate || !prompt.trim()}>
            <Icon name="ph:plus" aria-hidden /> New
          </button>
        </form>
        {error ? (
          <div className="journal-list__error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="journal-list__cap">Generated sketches</div>
        {artifacts.length === 0 ? (
          <div className="journal-empty">
            <Icon name="ph:sparkle" width={15} aria-hidden />
            No sketches yet — describe one above to get started.
          </div>
        ) : (
          <ul className="journal-list__items">
            {[...artifacts].reverse().map((a) => (
              <li key={a.id}>
                <div className={`journal-art${a.id === selectedId ? " is-selected" : ""}`}>
                  {editingTitleId === a.id ? (
                    <input
                      className="journal-art__rename"
                      value={editingTitleDraft}
                      autoFocus
                      aria-label="Rename canvas item"
                      onChange={(e) => setEditingTitleDraft(e.target.value)}
                      onBlur={() => commitRename(a.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(a.id);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="journal-art__select"
                      onClick={() => {
                        setSelectedId(a.id);
                        setView("preview");
                      }}
                    >
                      <span className="journal-art__title" title={a.title || "Untitled sketch"}>{a.title || "Untitled sketch"}</span>
                      <span className="journal-art__meta">
                        <span className={`journal-kind journal-kind--${a.kind ?? "html"}`}>{a.kind ?? "html"}</span>
                        {generating.has(a.id) ? " · generating…" : ` · ${relativeTime(a.updatedAt)}`}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="journal-art__rename-btn"
                    aria-label={`Rename ${a.title || "Untitled sketch"}`}
                    title="Rename"
                    onClick={() => startRename(a)}
                  >
                    <Icon name="ph:pencil-simple" width={13} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <MaybePortal active={fullscreen}>
      <section className={`journal-detail${fullscreen ? " journal-detail--fullscreen" : ""}`} aria-label="Sketch preview">
        {selected ? (
          <>
            <div className="journal-detail__bar">
              <div className="journal-seg" role="tablist" aria-label="Preview or code">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "preview"}
                  className={view === "preview" ? "on" : ""}
                  onClick={() => setView("preview")}
                >
                  Preview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "code"}
                  className={view === "code" ? "on" : ""}
                  onClick={() => setView("code")}
                >
                  Code
                </button>
              </div>
              <div className="journal-detail__actions">
                <button
                  type="button"
                  className={`journal-act${fullscreen ? " journal-act--on" : ""}`}
                  aria-label={fullscreen ? "Exit full screen" : "View full screen"}
                  aria-pressed={fullscreen}
                  title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
                  onClick={() => setFullscreen((v) => !v)}
                >
                  <Icon name={fullscreen ? "ph:arrows-in-simple" : "ph:arrows-out-simple"} aria-hidden />
                </button>
                {view === "code" ? (
                  <>
                    <button
                      type="button"
                      className={`journal-act${copied ? " journal-act--on" : ""}`}
                      aria-label={copied ? "Copied" : "Copy code"}
                      onClick={async () => {
                        if (!(await copyText(codeDraft))) return;
                        setCopied(true);
                        if (copiedTimer.current) clearTimeout(copiedTimer.current);
                        copiedTimer.current = setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      <Icon name={copied ? "ph:check" : "ph:copy"} aria-hidden /> {copied ? "Copied" : "Copy"}
                    </button>
                    <button
                      type="button"
                      className="journal-act"
                      aria-label="Revert canvas code edits"
                      disabled={!codeDirty}
                      onClick={revertCodeEdit}
                    >
                      <Icon name="ph:arrow-counter-clockwise" aria-hidden /> Revert
                    </button>
                    <button
                      type="button"
                      className="journal-act journal-act--on"
                      aria-label="Save canvas code"
                      disabled={!codeDirty}
                      onClick={saveCodeEdit}
                    >
                      <Icon name="ph:floppy-disk-bold" aria-hidden /> Save
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className={`journal-act${refineOpen ? " journal-act--on" : ""}`}
                  disabled={!canGenerate || selectedBusy}
                  aria-expanded={refineOpen}
                  onClick={() => (refineOpen ? setRefineOpen(false) : openRefine())}
                >
                  <Icon name="ph:arrows-clockwise" aria-hidden /> {selectedBusy ? "Refining…" : "Refine"}
                </button>
                <button
                  type="button"
                  className="journal-act journal-act--danger"
                  onClick={() => removeArtifact(selected.id)}
                  aria-label="Delete sketch"
                >
                  <Icon name="ph:trash" aria-hidden />
                </button>
              </div>
            </div>
            {refineOpen ? (
              <div className="journal-refine" role="group" aria-label="Refine sketch">
                <textarea
                  ref={refineRef}
                  className="journal-refine__text"
                  aria-label="Describe the optimization you want"
                  placeholder="Describe the optimization you want…"
                  rows={2}
                  value={refineText}
                  disabled={selectedBusy}
                  onChange={(e) => setRefineText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRefine(); }
                    if (e.key === "Escape") { e.preventDefault(); setRefineOpen(false); }
                  }}
                />
                <p className="journal-refine__label">Suggestions</p>
                <div className="journal-refine__chips">
                  {DEFAULT_REFINE_SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="journal-refine__chip" disabled={selectedBusy} onClick={() => applySuggestion(s)}>
                      {s}
                    </button>
                  ))}
                </div>
                {generatedSuggestions.length ? (
                  <>
                    <p className="journal-refine__label"><Icon name="ph:sparkle" width={11} aria-hidden /> From this sketch</p>
                    <div className="journal-refine__chips">
                      {generatedSuggestions.map((s) => (
                        <button key={s} type="button" className="journal-refine__chip journal-refine__chip--gen" disabled={selectedBusy} onClick={() => applySuggestion(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                <div className="journal-refine__foot">
                  <span className="journal-refine__hint">⌘↵ to refine</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="journal-act" onClick={() => setRefineOpen(false)}>Cancel</button>
                  <button type="button" className="journal-refine__go" disabled={selectedBusy || !refineText.trim()} onClick={submitRefine}>
                    {selectedBusy ? "Refining…" : "Refine"}
                  </button>
                </div>
              </div>
            ) : null}
            {view === "preview" ? (
              <iframe
                className="journal-detail__frame"
                title={selected.title || "Sketch preview"}
                sandbox="allow-scripts"
                srcDoc={srcDocFor(selected)}
              />
            ) : (
              <textarea
                className="journal-detail__code journal-detail__code--editor"
                aria-label="Edit canvas code"
                spellCheck={false}
                value={codeDraft}
                disabled={selectedBusy}
                onChange={(e) => setCodeDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                    e.preventDefault();
                    saveCodeEdit();
                  }
                  if (e.key === "Escape" && codeDirty) {
                    e.preventDefault();
                    revertCodeEdit();
                  }
                }}
              />
            )}
            <div className="journal-detail__prompt">Prompt: “{selected.prompt}”</div>
          </>
        ) : (
          <div className="journal-empty journal-empty--pane">
            <EmptyState
              icon="ph:sparkle"
              headline={artifacts.length ? "Select a sketch to preview it" : "Sketch a UI with a familiar"}
              subtitle={
                artifacts.length
                  ? "Pick a sketch from the list to preview, refine, and iterate on it."
                  : "Describe a screen or component and a familiar generates a live, editable preview. Try a starting point:"
              }
              actions={
                artifacts.length ? undefined : (
                  <div className="journal-starters">
                    {STARTER_SKETCH_PROMPTS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="journal-starter"
                        disabled={!canGenerate}
                        onClick={() => applyStarter(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )
              }
            />
          </div>
        )}
      </section>
      </MaybePortal>
    </div>
  );
}

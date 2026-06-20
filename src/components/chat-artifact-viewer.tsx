"use client";

import "@/styles/chat-artifact.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  clampArtifactCode,
  titleFromPrompt,
  type ArtifactKind,
} from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import { generateArtifactCode } from "@/lib/canvas-generate";
import { DEFAULT_REFINE_SUGGESTIONS, generateRefineSuggestions } from "@/lib/refine-suggestions";
import { highlightToHtml } from "@/components/message-bubble";

type Props = {
  initialCode: string;
  kind: ArtifactKind;
  title: string;
  /** Active familiar; null disables Refine (generation needs a familiar). */
  familiarId: string | null;
  /** Original ask, stored as the artifact prompt when saved to Canvas. */
  sourcePrompt?: string;
};

type SaveState = "idle" | "saving" | "saved";

export function ChatArtifactViewer({ initialCode, kind: initialKind, title, familiarId, sourcePrompt }: Props) {
  const [code, setCode] = useState(initialCode);
  const [kind, setKind] = useState<ArtifactKind>(initialKind);
  const [tab, setTab] = useState<"canvas" | "code">("canvas");
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [refineText, setRefineText] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const refineRef = useRef<HTMLTextAreaElement | null>(null);

  // Context-aware ideas derived from the artifact itself; recomputed only when
  // the code/kind changes (cheap string scans). Paired with the static defaults
  // so the refine space always offers a starting point.
  const generatedSuggestions = useMemo(
    () => generateRefineSuggestions(code, kind),
    [code, kind],
  );

  const srcDoc = useMemo(
    () => (kind === "react" ? buildReactSrcDoc(code) : buildPreviewSrcDoc(code)),
    [kind, code],
  );

  // The opaque-origin sandbox can only talk back via postMessage; match the
  // message to THIS frame and surface runtime/compile failures as an overlay.
  useEffect(() => {
    setRuntimeError(null);
    function onMessage(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === "sandbox-error" && typeof e.data.message === "string") {
        setRuntimeError(e.data.message);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc]);

  // Escape exits the expanded (fullscreen) artifact view.
  useEffect(() => {
    if (!fullscreen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const copyCode = useCallback(() => {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
  }, [code]);

  const openInBrowser = useCallback(() => {
    try {
      const blob = new Blob([srcDoc], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch {
      /* popup blocked — the inline preview still works */
    }
  }, [srcDoc]);

  const runRefine = useCallback(async () => {
    const ask = refineText.trim();
    if (!ask || !familiarId || generating) return;
    setGenerating(true);
    setRuntimeError(null);
    const result = await generateArtifactCode({
      prompt: buildRefinePrompt(code, ask, kind),
      familiarId,
    });
    setGenerating(false);
    if (result.code) {
      setCode(clampArtifactCode(result.code));
      if (result.kind) setKind(result.kind);
      setRefineText("");
      setRefineOpen(false);
      setEditing(false);
      setTab("canvas");
      setSaveState("idle");
    } else {
      setRuntimeError(result.error || "Refine failed — try a different description.");
    }
  }, [refineText, familiarId, generating, code, kind]);

  const openRefine = useCallback(() => {
    if (!familiarId) return;
    setRefineOpen(true);
    // Focus after the panel mounts so the cursor lands in the textarea.
    requestAnimationFrame(() => refineRef.current?.focus());
  }, [familiarId]);

  // Tapping a suggestion seeds the textarea (replacing any draft) and refocuses,
  // so the user can run it as-is or tweak it first.
  const applySuggestion = useCallback((text: string) => {
    setRefineText(text);
    requestAnimationFrame(() => {
      const el = refineRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const saveToCanvas = useCallback(async () => {
    if (saveState === "saving") return;
    setSaveState("saving");
    const now = new Date().toISOString();
    const prompt = sourcePrompt?.trim() || title;
    const artifact = {
      id: `art-${crypto.randomUUID()}`,
      title: titleFromPrompt(prompt),
      prompt,
      code: clampArtifactCode(code),
      kind,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaveState("saved");
    } catch {
      setSaveState("idle");
      setRuntimeError("Couldn't save to Canvas.");
    }
  }, [saveState, sourcePrompt, title, code, kind]);

  const openInCanvas = useCallback(() => {
    try {
      localStorage.setItem("cave:journal:tab", "canvas");
    } catch {
      /* storage may be unavailable */
    }
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "journal" } }));
    window.dispatchEvent(new CustomEvent("cave:journal-set-tab", { detail: { tab: "canvas" } }));
    window.dispatchEvent(new Event("cave:board:reload"));
  }, []);

  const shell = (
    <div className={`chat-artifact${fullscreen ? " chat-artifact--fullscreen" : ""}`}>
      <div className="chat-artifact__head">
        <span className="chat-artifact__dots" aria-hidden>
          <i style={{ background: "#e0666b" }} />
          <i style={{ background: "#e0a44e" }} />
          <i style={{ background: "#5bbb6b" }} />
        </span>
        <div className="chat-artifact__seg" role="tablist" aria-label="Artifact view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "canvas"}
            className={`chat-artifact__tab${tab === "canvas" ? " is-active" : ""}`}
            onClick={() => setTab("canvas")}
          >
            <Icon name="ph:squares-four" width={13} /> Canvas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "code"}
            className={`chat-artifact__tab${tab === "code" ? " is-active" : ""}`}
            onClick={() => setTab("code")}
          >
            <Icon name="ph:code" width={13} /> Code
          </button>
        </div>
        <span className="chat-artifact__title" title={title}>{title}</span>
        <span className="chat-artifact__spacer" />
        <div className="chat-artifact__actions">
          {tab === "code" ? (
            <button type="button" className={`chat-artifact__btn${editing ? " is-active" : ""}`} title="Edit code" aria-label="Edit code" onClick={() => setEditing((v) => !v)}>
              <Icon name="ph:pencil-simple" width={14} />
            </button>
          ) : null}
          <button type="button" className="chat-artifact__btn" title="Copy code" aria-label="Copy code" onClick={copyCode}>
            <Icon name="ph:copy" width={14} />
          </button>
          <button
            type="button"
            className={`chat-artifact__btn${fullscreen ? " is-active" : ""}`}
            title={fullscreen ? "Exit fullscreen" : "Expand fullscreen"}
            aria-label={fullscreen ? "Exit fullscreen" : "Expand artifact fullscreen"}
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((v) => !v)}
          >
            <Icon name={fullscreen ? "ph:arrows-in-simple" : "ph:arrows-out-simple"} width={14} />
          </button>
          <button type="button" className="chat-artifact__btn" title="Open in browser" aria-label="Open in browser" onClick={openInBrowser}>
            <Icon name="ph:arrow-square-out" width={14} />
          </button>
          {saveState === "saved" ? (
            <button type="button" className="chat-artifact__btn chat-artifact__btn--text" onClick={openInCanvas}>
              <Icon name="ph:arrow-square-out" width={13} /> Open in Canvas
            </button>
          ) : (
            <button type="button" className="chat-artifact__btn chat-artifact__btn--text" disabled={saveState === "saving"} onClick={saveToCanvas}>
              <Icon name="ph:plus" width={13} /> {saveState === "saving" ? "Saving…" : "Save to Canvas"}
            </button>
          )}
        </div>
      </div>

      <div className="chat-artifact__body">
        {tab === "canvas" ? (
          <div className="chat-artifact__preview-wrap">
            <iframe
              ref={frameRef}
              className="chat-artifact__frame"
              title={title || "preview"}
              sandbox="allow-scripts allow-popups allow-modals"
              srcDoc={srcDoc}
            />
            {runtimeError ? (
              <div className="chat-artifact__error" role="alert">
                <Icon name="ph:warning-circle-fill" width={15} />
                <span className="chat-artifact__error-msg">{runtimeError}</span>
                <button type="button" className="chat-artifact__error-fix" onClick={() => setTab("code")}>View code</button>
              </div>
            ) : null}
          </div>
        ) : editing ? (
          <textarea
            className="chat-artifact__code-edit"
            spellCheck={false}
            value={code}
            onChange={(e) => { setCode(e.target.value); setSaveState("idle"); }}
          />
        ) : (
          <ArtifactCode code={code} kind={kind} />
        )}
      </div>

      {refineOpen ? (
        <div className="chat-artifact__refine-panel" role="group" aria-label="Refine artifact">
          <div className="chat-artifact__refine-head">
            <Icon name="ph:sparkle" width={14} className="chat-artifact__refine-icon" />
            <span className="chat-artifact__refine-title">Refine</span>
            <span className="chat-artifact__spacer" />
            <button
              type="button"
              className="chat-artifact__btn"
              title="Close refine"
              aria-label="Close refine"
              onClick={() => setRefineOpen(false)}
            >
              <Icon name="ph:x" width={13} />
            </button>
          </div>
          <textarea
            ref={refineRef}
            className="chat-artifact__refine-text"
            aria-label="Describe the optimization you want"
            placeholder="Describe the optimization you want…"
            rows={2}
            value={refineText}
            disabled={generating}
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void runRefine(); }
              if (e.key === "Escape") { e.preventDefault(); setRefineOpen(false); }
            }}
          />
          <div className="chat-artifact__suggests">
            <p className="chat-artifact__suggests-label">Suggestions</p>
            <div className="chat-artifact__chips">
              {DEFAULT_REFINE_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chat-artifact__chip"
                  disabled={generating}
                  onClick={() => applySuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            {generatedSuggestions.length ? (
              <>
                <p className="chat-artifact__suggests-label">
                  <Icon name="ph:sparkle" width={11} /> From this artifact
                </p>
                <div className="chat-artifact__chips">
                  {generatedSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chat-artifact__chip chat-artifact__chip--gen"
                      disabled={generating}
                      onClick={() => applySuggestion(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          <div className="chat-artifact__refine-foot">
            <span className="chat-artifact__refine-hint">⌘↵ to refine</span>
            <span className="chat-artifact__spacer" />
            <button type="button" className="chat-artifact__btn chat-artifact__btn--text" onClick={() => setRefineOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="chat-artifact__refine-go"
              disabled={generating || !refineText.trim()}
              onClick={() => void runRefine()}
            >
              {generating ? "Refining…" : "Refine"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="chat-artifact__refine-trigger"
          disabled={!familiarId}
          onClick={openRefine}
        >
          <Icon name="ph:sparkle" width={14} className="chat-artifact__refine-icon" />
          {familiarId ? "Refine the artifact…" : "Pick a familiar to refine"}
        </button>
      )}
    </div>
  );

  // When expanded, portal the shell to <body> so it escapes the chat turn's
  // containing block. The turn row (.cave-linear-turn) uses
  // `content-visibility: auto`, which implies `contain: layout paint` — that
  // makes it a containing block for position:fixed descendants, so an inline
  // `.chat-artifact--fullscreen` overlay would be clipped to the turn's box
  // instead of filling the viewport. Inline (non-fullscreen) stays in place.
  return fullscreen && typeof document !== "undefined"
    ? createPortal(shell, document.body)
    : shell;
}

/**
 * The Code tab's read-only view: the same code, Shiki-highlighted to match the
 * chat code blocks. Falls back to plain text until the (lazy) highlighter
 * resolves, and on any highlight failure, so the code is always shown. React
 * artifacts highlight as TSX; everything else as HTML.
 */
function ArtifactCode({ code, kind }: { code: string; kind: ArtifactKind }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void highlightToHtml(code, kind === "react" ? "tsx" : "html")
      .then((h) => { if (!cancelled) setHtml(h); })
      .catch(() => { if (!cancelled) setHtml(null); });
    return () => { cancelled = true; };
  }, [code, kind]);

  if (!html) {
    return <pre className="chat-artifact__code"><code>{code}</code></pre>;
  }
  return (
    <div
      className="chat-artifact__code chat-artifact__code--hl"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

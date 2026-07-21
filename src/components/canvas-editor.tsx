"use client";

// Full-surface sketch editor for the Canvas tab (design-handoff redesign).
// Three modes over the sandboxed sketch iframe: Select (inspect a component),
// Comment (pin persisted annotations to components), and Edit (live inline
// style experiments driven through the inspector channel). A design-chat rail
// runs refine requests through the same familiar generation path as the
// inline artifact viewer and persists accepted revisions to /api/canvas.

import "@/styles/canvas-editor.css";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  clampArtifactCode,
  sanitizeCanvasComponentTarget,
  type ArtifactKind,
  type CanvasAnnotation,
  type CanvasArtifact,
  type CanvasComponentTarget,
} from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import { generateArtifactCode } from "@/lib/canvas-generate";
import { buildCanvasCommentsRequest } from "@/lib/canvas-comments";
import {
  CANVAS_INSPECTOR_READY_MESSAGE_TYPE,
  createCanvasInspectorChannel,
  isCanvasComponentSelectedMessage,
} from "@/lib/canvas-inspector";

type EditorMode = "select" | "comment" | "edit";

type ChatMessage = {
  id: string;
  role: "agent" | "user";
  text: string;
};

// Per-component style experiment. `dirty` records which properties the user
// actually touched — only those are sent to the sketch and described to the
// familiar; everything else stays untouched sketch CSS.
type ComponentStyleDraft = {
  fontSize: number;
  padding: number;
  radius: number;
  borderW: number;
  weight: number;
  color: string | null;
  bg: string | null;
  dirty: StyleKey[];
};

type StyleKey = "fontSize" | "padding" | "radius" | "borderW" | "weight" | "color" | "bg";

const DEFAULT_STYLE_DRAFT: ComponentStyleDraft = {
  fontSize: 14,
  padding: 0,
  radius: 0,
  borderW: 0,
  weight: 400,
  color: null,
  bg: null,
  dirty: [],
};

// Literal colors ON PURPOSE: swatches (and the border color below) style the
// SKETCH's content — an arbitrary light-ground page inside the sandboxed
// iframe — not the app UI. App theme tokens never reach the sketch document,
// so semantic tokens can't apply here; this follows the gallery thumbnail
// precedent of a fixed `#fff` sketch ground.
const TEXT_SWATCHES: { value: string; name: string }[] = [
  { value: "#1a1a1a", name: "Ink" },
  { value: "#6b7280", name: "Muted" },
  { value: "#7c5cff", name: "Accent" },
];
const BG_SWATCHES: { value: string; name: string }[] = [
  { value: "transparent", name: "None" },
  { value: "#f4f4f5", name: "Surface" },
  { value: "#ede9fe", name: "Accent tint" },
];
const SKETCH_BORDER_COLOR = "#d4d4d8";

const NUMBER_ROWS: { key: StyleKey; label: string }[] = [
  { key: "fontSize", label: "Font size" },
  { key: "padding", label: "Padding" },
  { key: "radius", label: "Corner radius" },
  { key: "borderW", label: "Border width" },
];

const WEIGHTS = [400, 500, 600];

/** Map one edited draft property to the CSS the sketch should receive. */
function styleOverrideCss(draft: ComponentStyleDraft, keys: StyleKey[]): Record<string, string> {
  const css: Record<string, string> = {};
  for (const key of keys) {
    switch (key) {
      case "fontSize": css["font-size"] = `${draft.fontSize}px`; break;
      case "padding": css["padding"] = `${draft.padding}px`; break;
      case "radius": css["border-radius"] = `${draft.radius}px`; break;
      case "borderW":
        css["border"] = draft.borderW > 0 ? `${draft.borderW}px solid ${SKETCH_BORDER_COLOR}` : "none";
        break;
      case "weight": css["font-weight"] = String(draft.weight); break;
      case "color": if (draft.color) css["color"] = draft.color; break;
      case "bg": if (draft.bg !== null) css["background"] = draft.bg; break;
    }
  }
  return css;
}

/** Human/familiar-readable description of every dirty style edit. */
export function describeStyleEdits(
  drafts: Record<string, ComponentStyleDraft>,
  labels: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const [selector, draft] of Object.entries(drafts)) {
    if (draft.dirty.length === 0) continue;
    const css = styleOverrideCss(draft, draft.dirty);
    const props = Object.entries(css).map(([property, value]) => `${property}: ${value}`);
    if (props.length === 0) continue;
    const label = labels[selector];
    lines.push(`- ${label ? `${label} (selector \`${selector}\`)` : `Selector \`${selector}\``}: ${props.join("; ")}`);
  }
  if (lines.length === 0) return "";
  return [
    "Apply exactly these style changes to the listed components (keep everything else untouched):",
    ...lines,
  ].join("\n");
}

let messageSeq = 0;
function chatMessage(role: ChatMessage["role"], text: string): ChatMessage {
  messageSeq += 1;
  return { id: `msg-${messageSeq}-${Date.now().toString(36)}`, role, text };
}

const SEED_MESSAGE = "I can suggest design improvements — select a component and ask, or pin comments in Comment mode.";

export function CanvasEditor(props: {
  artifact: CanvasArtifact;
  familiarId: string | null;
  onClose: () => void;
  onArtifactUpdated?: (artifact: CanvasArtifact, artifacts: CanvasArtifact[]) => void;
}): React.JSX.Element {
  const { artifact, familiarId, onClose, onArtifactUpdated } = props;

  const [code, setCode] = useState(artifact.code);
  const [kind, setKind] = useState<ArtifactKind>(artifact.kind ?? "html");
  const [mode, setMode] = useState<EditorMode>("select");
  const [selection, setSelection] = useState<CanvasComponentTarget | null>(null);
  const [inspectorLoaded, setInspectorLoaded] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<CanvasAnnotation[]>(artifact.annotations ?? []);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [applyingComments, setApplyingComments] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [chatMessage("agent", SEED_MESSAGE)]);
  const [generating, setGenerating] = useState(false);
  const [styleDrafts, setStyleDrafts] = useState<Record<string, ComponentStyleDraft>>({});
  const [announcement, setAnnouncement] = useState("");

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const artifactRef = useRef(artifact);
  const codeRef = useRef(code);
  const kindRef = useRef(kind);
  const modeRef = useRef(mode);
  const selectionRef = useRef(selection);
  const annotationsRef = useRef(annotations);
  const styleDraftsRef = useRef(styleDrafts);
  const styleLabelsRef = useRef<Record<string, string>>({});
  const generatingRef = useRef(false);
  const commentBusyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const inspectorChannelRef = useRef<ReturnType<typeof createCanvasInspectorChannel> | null>(null);
  const inspectorLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onArtifactUpdatedRef = useRef(onArtifactUpdated);

  codeRef.current = code;
  kindRef.current = kind;
  modeRef.current = mode;
  selectionRef.current = selection;
  annotationsRef.current = annotations;
  styleDraftsRef.current = styleDrafts;
  onArtifactUpdatedRef.current = onArtifactUpdated;

  const inspectorGeneration = useMemo(() => crypto.randomUUID(), [kind, code]);
  const srcDoc = useMemo(
    () => (
      kind === "react"
        ? buildReactSrcDoc(code, inspectorGeneration)
        : buildPreviewSrcDoc(code, inspectorGeneration)
    ),
    [kind, code, inspectorGeneration],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const pushMessage = useCallback((role: ChatMessage["role"], text: string) => {
    setChatMessages((current) => [...current, chatMessage(role, text)]);
    requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /** Accept the server-authoritative artifact after any successful write. */
  const adoptServerArtifact = useCallback((next: CanvasArtifact, artifacts: CanvasArtifact[]) => {
    artifactRef.current = next;
    setAnnotations(next.annotations ?? []);
    onArtifactUpdatedRef.current?.(next, artifacts);
  }, []);

  // ── Inspector wiring (mirrors chat-artifact-viewer) ───────────────────────

  const acceptInspectorSelection = useCallback((value: unknown) => {
    if (!isCanvasComponentSelectedMessage(value)) return;
    const target = sanitizeCanvasComponentTarget(value.target);
    if (!target) return;
    // Mock behavior: in Select mode, clicking the selected component again
    // clears the selection.
    if (modeRef.current === "select" && selectionRef.current?.selector === target.selector) {
      selectionRef.current = null;
      setSelection(null);
      setAnnouncement("Selection cleared.");
      return;
    }
    selectionRef.current = target;
    styleLabelsRef.current[target.selector] = target.label || target.selector;
    setSelection(target);
    setAnnouncement(`Selected ${target.label || target.selector}.`);
  }, []);

  useLayoutEffect(() => {
    setInspectorLoaded(false);
    const channel = createCanvasInspectorChannel({
      onLoaded: () => {
        if (inspectorLoadTimerRef.current) clearTimeout(inspectorLoadTimerRef.current);
        inspectorLoadTimerRef.current = null;
        setInspectorLoaded(true);
      },
      onSelection: acceptInspectorSelection,
    });
    inspectorChannelRef.current = channel;

    function onBootstrap(event: MessageEvent) {
      // Validation invariant (cave-mnz1, same as chat-artifact-viewer): the
      // e.source identity check IS the security boundary — do NOT add an
      // e.origin check. The sandbox omits allow-same-origin, so the frame's
      // origin is OPAQUE (e.origin === "null") and an origin comparison would
      // silently drop every legitimate message. Source identity is stronger
      // anyway: only this exact frame's contentWindow passes.
      if (event.source !== frameRef.current?.contentWindow) return;
      if (
        event.data?.type !== CANVAS_INSPECTOR_READY_MESSAGE_TYPE
        || event.data?.generation !== inspectorGeneration
        || !event.ports?.[0]
      ) {
        return;
      }
      channel.acceptBootstrap(event.ports[0]);
    }

    window.addEventListener("message", onBootstrap);
    return () => {
      window.removeEventListener("message", onBootstrap);
      if (inspectorLoadTimerRef.current) clearTimeout(inspectorLoadTimerRef.current);
      inspectorLoadTimerRef.current = null;
      channel.dispose();
      if (inspectorChannelRef.current === channel) inspectorChannelRef.current = null;
    };
  }, [acceptInspectorSelection, inspectorGeneration]);

  const handlePreviewLoad = useCallback(() => {
    const channel = inspectorChannelRef.current;
    const status = channel?.handleFrameLoad();
    if (status === "authenticated") return;
    const disableInspection = () => {
      if (inspectorChannelRef.current !== channel) return;
      setInspectorLoaded(false);
      setRuntimeError("The sketch navigated away from its preview. Reopen it from the gallery to keep editing.");
    };
    if (status !== "pending") {
      disableInspection();
      return;
    }
    if (inspectorLoadTimerRef.current) clearTimeout(inspectorLoadTimerRef.current);
    inspectorLoadTimerRef.current = setTimeout(() => {
      inspectorLoadTimerRef.current = null;
      if (inspectorChannelRef.current !== channel) return;
      if (channel?.settleFrameLoad() === "authenticated") return;
      disableInspection();
    }, 250);
  }, []);

  // Selection stays enabled in every mode — the modes change what the aside
  // does with the selected component, not whether one can be picked.
  useEffect(() => {
    if (!inspectorLoaded) return;
    try {
      inspectorChannelRef.current?.setEnabled(true);
    } catch {
      // A srcdoc navigation may close the previous port between render and load.
    }
  }, [inspectorLoaded]);

  // Sandbox runtime failures surface as an overlay alert; the same
  // e.source-identity check as the bootstrap listener (see cave-mnz1 above).
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

  // A frame reload (new code/generation) drops preview-only inline styles, so
  // stale dirty flags would describe edits the sketch no longer shows.
  useEffect(() => {
    setStyleDrafts({});
  }, [srcDoc]);

  // Escape clears the selection — unless focus sits in a field that still has
  // content (conventional: Escape there belongs to the field/draft).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !selectionRef.current) return;
      const active = document.activeElement;
      if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
        && active.value.trim()
      ) {
        return;
      }
      selectionRef.current = null;
      setSelection(null);
      setAnnouncement("Selection cleared.");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Edit mode: live style overrides ───────────────────────────────────────

  const selectedDraft = selection
    ? styleDrafts[selection.selector] ?? DEFAULT_STYLE_DRAFT
    : DEFAULT_STYLE_DRAFT;

  const setStyleValue = useCallback((key: StyleKey, value: number | string | null) => {
    const target = selectionRef.current;
    if (!target) return;
    const previous = styleDraftsRef.current[target.selector] ?? DEFAULT_STYLE_DRAFT;
    const next: ComponentStyleDraft = {
      ...previous,
      [key]: value,
      dirty: previous.dirty.includes(key) ? previous.dirty : [...previous.dirty, key],
    };
    const drafts = { ...styleDraftsRef.current, [target.selector]: next };
    styleDraftsRef.current = drafts;
    setStyleDrafts(drafts);
    try {
      inspectorChannelRef.current?.applyStyleOverride(target.selector, styleOverrideCss(next, [key]));
    } catch {
      // Port may be mid-teardown across a srcdoc swap; the edit stays in the draft.
    }
  }, []);

  const dirtyStyleDescription = useMemo(
    () => describeStyleEdits(styleDrafts, styleLabelsRef.current),
    [styleDrafts],
  );

  // ── Persistence helpers ───────────────────────────────────────────────────

  /**
   * Generate a revision with the familiar and persist it. Reports progress into
   * the design chat; used by chat sends, Apply comments, and Apply style edits.
   */
  const runRefine = useCallback(async (
    ask: string,
    options: {
      successText: string;
      clearAnnotations?: boolean;
      resolvedAnnotations?: { id: string; updatedAt: string }[];
      onSaved?: () => void;
      onFailure?: (text: string) => void;
    },
  ) => {
    if (!familiarId || generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    const report = (text: string) => {
      pushMessage("agent", text);
      options.onFailure?.(text);
    };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await generateArtifactCode({
        prompt: buildRefinePrompt(codeRef.current, ask, kindRef.current),
        familiarId,
        signal: ctrl.signal,
      });
      if (!mountedRef.current || ctrl.signal.aborted || result.error === "cancelled") return;
      if (!result.code) {
        report(result.error ?? "The familiar returned nothing renderable — try rephrasing.");
        return;
      }
      const nextCode = clampArtifactCode(result.code);
      const nextKind = result.kind ?? kindRef.current;
      const persisted = artifactRef.current;
      const expectedUpdatedAt = persisted.updatedAt;
      const revised: CanvasArtifact = {
        ...persisted,
        code: nextCode,
        kind: nextKind,
        updatedAt: new Date().toISOString(),
        ...(options.clearAnnotations ? { annotations: [] } : {}),
      };
      // Show the generated sketch immediately — even if the save below
      // conflicts, the generated code stays on screen instead of vanishing.
      setCode(nextCode);
      setKind(nextKind);
      let res: Response;
      try {
        res = await fetch("/api/canvas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            artifact: revised,
            expectedUpdatedAt,
            ...(options.resolvedAnnotations ? { resolvedAnnotations: options.resolvedAnnotations } : {}),
          }),
        });
      } catch {
        report("The sketch was updated here, but saving failed — check your connection and ask again to retry.");
        return;
      }
      if (!mountedRef.current) return;
      if (res.status === 409) {
        report("This sketch changed somewhere else, so the new version wasn't saved. It's still on screen — reopen the sketch and retry.");
        return;
      }
      if (res.status === 404) {
        report("This sketch was deleted elsewhere, so the new version wasn't saved. It's still on screen — save it as a new sketch from chat if you want to keep it.");
        return;
      }
      if (!res.ok) {
        report(`The sketch was updated here, but saving failed (${res.status}). Ask again to retry.`);
        return;
      }
      const data = (await res.json()) as { artifact?: CanvasArtifact; artifacts?: CanvasArtifact[] };
      if (data.artifact) adoptServerArtifact(data.artifact, data.artifacts ?? []);
      pushMessage("agent", options.successText);
      setAnnouncement(options.successText);
      options.onSaved?.();
    } catch (err) {
      if (mountedRef.current && !ctrl.signal.aborted) {
        report((err as Error)?.message ?? "Refine failed — the connection dropped.");
      }
    } finally {
      abortRef.current = null;
      generatingRef.current = false;
      if (mountedRef.current) setGenerating(false);
    }
  }, [adoptServerArtifact, familiarId, pushMessage]);

  // ── Design chat ───────────────────────────────────────────────────────────

  const sendChat = useCallback(() => {
    const ask = chatDraft.trim();
    if (!ask || generatingRef.current) return;
    const attached = selectionRef.current;
    pushMessage("user", `${attached ? `[${attached.label || attached.selector}] ` : ""}${ask}`);
    setChatDraft("");
    if (!familiarId) {
      pushMessage("agent", "Pick a familiar to run design changes.");
      return;
    }
    const contextualAsk = attached
      ? [
          ask,
          "",
          "Apply this to the selected component:",
          `Label: ${attached.label || "(unlabelled)"}`,
          `Selector: ${attached.selector}`,
          ...(attached.excerpt ? [`Excerpt: ${attached.excerpt}`] : []),
        ].join("\n")
      : ask;
    void runRefine(contextualAsk, { successText: "Applied — the sketch is updated." });
  }, [chatDraft, familiarId, pushMessage, runRefine]);

  // ── Comments ──────────────────────────────────────────────────────────────

  const pinComment = useCallback(async () => {
    const note = commentDraft.trim();
    const target = selectionRef.current ? sanitizeCanvasComponentTarget(selectionRef.current) : null;
    if (!note || !target || commentBusyRef.current) return;
    const now = new Date().toISOString();
    const annotation: CanvasAnnotation = {
      id: `annotation-${crypto.randomUUID()}`,
      target,
      note,
      createdAt: now,
      updatedAt: now,
    };
    commentBusyRef.current = true;
    setCommentBusy(true);
    setCommentError(null);
    try {
      const res = await fetch("/api/canvas", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: artifactRef.current.id, annotation }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { artifact?: CanvasArtifact; artifacts?: CanvasArtifact[] };
      if (!mountedRef.current) return;
      if (data.artifact) adoptServerArtifact(data.artifact, data.artifacts ?? []);
      // The draft clears only on success — a failed pin keeps it for retry.
      setCommentDraft("");
      setAnnouncement(`Comment pinned to ${target.label || target.selector}.`);
    } catch {
      if (mountedRef.current) {
        setCommentError("Couldn't pin the comment. Check your connection, then press Pin again.");
      }
    } finally {
      commentBusyRef.current = false;
      if (mountedRef.current) setCommentBusy(false);
    }
  }, [adoptServerArtifact, commentDraft]);

  const removeComment = useCallback(async (annotation: CanvasAnnotation) => {
    if (commentBusyRef.current) return;
    commentBusyRef.current = true;
    setCommentBusy(true);
    setCommentError(null);
    try {
      const res = await fetch("/api/canvas", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: artifactRef.current.id, removeAnnotationId: annotation.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { artifact?: CanvasArtifact; artifacts?: CanvasArtifact[] };
      if (!mountedRef.current) return;
      if (data.artifact) adoptServerArtifact(data.artifact, data.artifacts ?? []);
      setAnnouncement("Comment removed.");
    } catch {
      if (mountedRef.current) {
        setCommentError("Couldn't remove the comment. Check your connection, then retry.");
      }
    } finally {
      commentBusyRef.current = false;
      if (mountedRef.current) setCommentBusy(false);
    }
  }, [adoptServerArtifact]);

  const notedCount = annotations.filter((annotation) => annotation.note.trim()).length;

  const applyComments = useCallback(() => {
    if (generatingRef.current || applyingComments) return;
    const { prompt, resolvedAnnotations } = buildCanvasCommentsRequest(annotationsRef.current);
    if (!prompt) {
      setCommentError("Add a requested change to at least one comment.");
      return;
    }
    if (!familiarId) {
      setCommentError("Pick a familiar to apply comments.");
      return;
    }
    setCommentError(null);
    setApplyingComments(true);
    void runRefine(prompt, {
      successText: "Applied your comments — the sketch is updated.",
      clearAnnotations: true,
      resolvedAnnotations,
      onFailure: (text) => setCommentError(`${text} Your comments were kept.`),
    }).finally(() => {
      if (mountedRef.current) setApplyingComments(false);
    });
  }, [applyingComments, familiarId, runRefine]);

  // ── Edit mode → familiar handoff ──────────────────────────────────────────

  const applyStyleEdits = useCallback(() => {
    if (generatingRef.current || !dirtyStyleDescription) return;
    pushMessage("user", dirtyStyleDescription);
    if (!familiarId) {
      pushMessage("agent", "Pick a familiar to run design changes.");
      return;
    }
    void runRefine(dirtyStyleDescription, {
      successText: "Applied your style edits — the sketch is updated.",
      onSaved: () => {
        styleDraftsRef.current = {};
        setStyleDrafts({});
      },
    });
  }, [dirtyStyleDescription, familiarId, pushMessage, runRefine]);

  // ── Render ────────────────────────────────────────────────────────────────

  const selectionLabel = selection ? selection.label || selection.selector : "Nothing selected";
  const panelTitle = mode === "edit" ? "Inspector" : mode === "comment" ? "Comments" : "Selection";

  const modeButton = (id: EditorMode, label: string, title: string) => (
    <button
      type="button"
      className={`canvas-editor__mode focus-ring-inset${mode === id ? " is-active" : ""}`}
      title={title}
      aria-pressed={mode === id}
      onClick={() => setMode(id)}
    >
      {label}
    </button>
  );

  const swatchRow = (
    label: string,
    swatches: { value: string; name: string }[],
    key: StyleKey,
    current: string | null,
  ) => (
    <div className="canvas-editor__insp-row">
      <span className="canvas-editor__insp-label">{label}</span>
      {swatches.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          title={swatch.name}
          aria-label={`${label}: ${swatch.name}`}
          aria-pressed={current === swatch.value}
          className={`canvas-editor__swatch focus-ring${current === swatch.value ? " is-selected" : ""}`}
          style={swatch.value === "transparent" ? undefined : { background: swatch.value }}
          onClick={() => setStyleValue(key, swatch.value)}
        />
      ))}
    </div>
  );

  return (
    <div className="canvas-editor">
      <span className="sr-only" aria-live="polite">{announcement}</span>

      <div className="canvas-editor__head">
        <button type="button" className="canvas-editor__back focus-ring" onClick={onClose}>
          ← Gallery
        </button>
        <span className="canvas-editor__title" title={artifact.title}>{artifact.title}</span>
        <span className="canvas-editor__modes" role="group" aria-label="Editor mode">
          {modeButton("select", "Select", "Select components")}
          {modeButton("comment", "Comment", "Pin comments to components")}
          {modeButton("edit", "Edit", "Edit fonts, borders, padding")}
        </span>
        <button type="button" className="canvas-editor__done focus-ring" onClick={onClose}>
          Done
        </button>
      </div>

      <div className="canvas-editor__body">
        <div className="canvas-editor__stage">
          <div className="canvas-editor__frame-shell">
            <iframe
              ref={frameRef}
              className="canvas-editor__frame"
              title={artifact.title || "sketch"}
              sandbox="allow-scripts allow-popups allow-modals"
              srcDoc={srcDoc}
              onLoad={handlePreviewLoad}
            />
            {runtimeError ? (
              <div className="canvas-editor__error" role="alert">
                <Icon name="ph:warning-circle-fill" width={15} aria-hidden />
                <span>{runtimeError}</span>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="canvas-editor__aside">
          <div className="canvas-editor__panel-head">
            <span className="canvas-editor__panel-title">{panelTitle}</span>
            <span className={`canvas-editor__panel-target${selection ? " has-selection" : ""}`}>
              {selectionLabel}
            </span>
          </div>

          <div className="canvas-editor__panel-body">
            {mode === "select" ? (
              <>
                <p className="canvas-editor__hint">
                  Click a component to select it — then edit it in Edit mode, pin a comment,
                  or attach it to the design chat below.
                </p>
                {selection ? (
                  <div className="canvas-editor__sel-card">
                    <span className="canvas-editor__sel-label">{selection.label || "Unlabelled component"}</span>
                    <code className="canvas-editor__sel-selector">{selection.selector}</code>
                    {selection.excerpt ? (
                      <span className="canvas-editor__sel-excerpt">{selection.excerpt}</span>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {mode === "edit" && !selection ? (
              <p className="canvas-editor__hint">
                Select a component on the canvas to edit its font, color, border, and padding.
              </p>
            ) : null}

            {mode === "edit" && selection ? (
              <>
                {NUMBER_ROWS.map((row) => (
                  <div key={row.key} className="canvas-editor__insp-row">
                    <span className="canvas-editor__insp-label">{row.label}</span>
                    <input
                      className="canvas-editor__insp-num focus-ring"
                      type="number"
                      min={0}
                      max={64}
                      aria-label={row.label}
                      value={selectedDraft[row.key] as number}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        setStyleValue(row.key, Math.min(64, Math.max(0, Number.isFinite(parsed) ? parsed : 0)));
                      }}
                    />
                    <span className="canvas-editor__insp-unit">px</span>
                  </div>
                ))}
                <div className="canvas-editor__insp-row">
                  <span className="canvas-editor__insp-label">Weight</span>
                  <span className="canvas-editor__weights" role="group" aria-label="Font weight">
                    {WEIGHTS.map((weight) => (
                      <button
                        key={weight}
                        type="button"
                        className={`canvas-editor__weight focus-ring-inset${selectedDraft.weight === weight ? " is-active" : ""}`}
                        aria-pressed={selectedDraft.weight === weight}
                        onClick={() => setStyleValue("weight", weight)}
                      >
                        {weight}
                      </button>
                    ))}
                  </span>
                </div>
                {swatchRow("Text color", TEXT_SWATCHES, "color", selectedDraft.color)}
                {swatchRow("Background", BG_SWATCHES, "bg", selectedDraft.bg)}
                <p className="canvas-editor__hint">
                  Style edits preview live — ask the design chat to make them permanent.
                </p>
                {dirtyStyleDescription ? (
                  <button
                    type="button"
                    className="canvas-editor__apply focus-ring"
                    disabled={generating || !familiarId}
                    title={familiarId ? "Rewrite the sketch with these style edits" : "Pick a familiar to run design changes"}
                    onClick={applyStyleEdits}
                  >
                    <Icon name="ph:sparkle" width={13} aria-hidden />
                    {generating ? "Applying…" : "Apply via familiar"}
                  </button>
                ) : null}
              </>
            ) : null}

            {mode === "comment" ? (
              <>
                <div className="canvas-editor__comments">
                  {annotations.length === 0 ? (
                    <p className="canvas-editor__hint">
                      No comments yet — select a component and pin the first one.
                    </p>
                  ) : (
                    annotations.map((annotation) => (
                      <div key={annotation.id} className="canvas-editor__comment">
                        <span className="canvas-editor__comment-target">
                          {annotation.target.label || annotation.target.selector}
                        </span>
                        <span className="canvas-editor__comment-note">{annotation.note}</span>
                        <button
                          type="button"
                          className="canvas-editor__comment-remove focus-ring"
                          title="Remove comment"
                          aria-label={`Remove comment on ${annotation.target.label || annotation.target.selector}`}
                          disabled={commentBusy || applyingComments}
                          onClick={() => void removeComment(annotation)}
                        >
                          <Icon name="ph:trash" width={13} aria-hidden />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {commentError ? (
                  <p className="canvas-editor__comment-error" role="alert">{commentError}</p>
                ) : null}
                {notedCount > 0 ? (
                  <button
                    type="button"
                    className="canvas-editor__apply focus-ring"
                    disabled={generating || applyingComments || commentBusy}
                    onClick={applyComments}
                  >
                    <Icon name="ph:sparkle" width={13} aria-hidden />
                    {applyingComments || generating
                      ? "Applying…"
                      : `Apply ${notedCount} comment${notedCount === 1 ? "" : "s"}`}
                  </button>
                ) : null}
                <div className="canvas-editor__pin-row">
                  <input
                    className="canvas-editor__input focus-ring"
                    value={commentDraft}
                    placeholder={selection ? `Comment on ${selection.label || selection.selector}…` : "Select a component first…"}
                    aria-label="Comment text"
                    disabled={commentBusy}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void pinComment();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="canvas-editor__pin focus-ring"
                    disabled={!selection || !commentDraft.trim() || commentBusy}
                    onClick={() => void pinComment()}
                  >
                    Pin
                  </button>
                </div>
              </>
            ) : null}
          </div>

          <div className="canvas-editor__chat">
            <span className="canvas-editor__chat-label">Design chat</span>
            <div ref={chatScrollRef} className="canvas-editor__chat-scroll">
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`canvas-editor__msg canvas-editor__msg--${message.role}`}
                >
                  {message.text}
                </div>
              ))}
              {generating ? (
                <div className="canvas-editor__msg canvas-editor__msg--agent canvas-editor__msg--busy">
                  Refining…
                </div>
              ) : null}
            </div>
            {selection ? (
              <span className="canvas-editor__attach">
                Attached: {selection.label || selection.selector}
              </span>
            ) : null}
            <div className="canvas-editor__chat-row">
              <input
                className="canvas-editor__input focus-ring"
                value={chatDraft}
                placeholder="Ask for design improvements…"
                aria-label="Ask for design improvements"
                onChange={(event) => setChatDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    sendChat();
                  }
                }}
              />
              <button
                type="button"
                className="canvas-editor__send focus-ring"
                title="Send"
                aria-label="Send design request"
                disabled={!chatDraft.trim() || generating}
                onClick={sendChat}
              >
                <Icon name="ph:arrow-up" width={13} aria-hidden />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

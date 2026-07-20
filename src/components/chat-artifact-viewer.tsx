"use client";

import "@/styles/chat-artifact.css";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Tabs } from "@/components/ui/tabs";
import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  clampArtifactCode,
  sanitizeCanvasComponentTarget,
  titleFromPrompt,
  type ArtifactKind,
  type CanvasAnnotation,
  type CanvasArtifact,
} from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import { openArtifactInTab } from "@/lib/artifact-open";
import { generateArtifactCode } from "@/lib/canvas-generate";
import {
  buildCanvasCommentsRequest,
  removeCanvasAnnotationDraft,
  replaceCanvasAnnotationNote,
  upsertCanvasAnnotationDraft,
} from "@/lib/canvas-comments";
import {
  CanvasAnnotationOperationQueue,
  overlayCanvasAnnotationOperations,
  readCanvasAnnotationOperations,
  writeCanvasAnnotationOperations,
  type CanvasAnnotationOperation,
} from "@/lib/canvas-annotation-operation-queue";
import {
  adoptCanvasContentSnapshot,
  canvasContentDiffers,
  reconcileCanvasAnnotationSnapshot,
} from "@/lib/canvas-content-sync";
import {
  CANVAS_INSPECTOR_READY_MESSAGE_TYPE,
  createCanvasInspectorChannel,
  isCanvasComponentSelectedMessage,
} from "@/lib/canvas-inspector";
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
  /** Persisted identity opts the viewer into component comment mode. */
  artifact?: CanvasArtifact;
  onArtifactUpdated?: (artifact: CanvasArtifact, artifacts: CanvasArtifact[]) => void;
};
type SaveState = "idle" | "saving" | "saved";
const CONTENT_CONFLICT_MESSAGE = "Saved artifact changed; reopen it, or save your work as a copy before applying comments.";

export function ChatArtifactViewer({
  initialCode,
  kind: initialKind,
  title,
  familiarId,
  sourcePrompt,
  artifact,
  onArtifactUpdated,
}: Props) {
  const [annotationStorage] = useState<Storage | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  });
  const [initialPendingAnnotationOperations] = useState(() => (
    readCanvasAnnotationOperations(annotationStorage, artifact?.id)
  ));
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
  const [commentMode, setCommentMode] = useState(false);
  const [inspectorLoaded, setInspectorLoaded] = useState(false);
  const [annotations, setAnnotations] = useState<CanvasAnnotation[]>(() => (
    overlayCanvasAnnotationOperations(
      artifact?.annotations ?? [],
      initialPendingAnnotationOperations,
    )
  ));
  const [applyingComments, setApplyingComments] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsSaveError, setCommentsSaveError] = useState<string | null>(null);
  const [contentConflict, setContentConflict] = useState(false);
  const [commentsRecovery, setCommentsRecovery] = useState<{
    code: string;
    kind: ArtifactKind;
  } | null>(null);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const refineRef = useRef<HTMLTextAreaElement | null>(null);
  const refineAbortRef = useRef<AbortController | null>(null);
  const artifactRef = useRef(artifact);
  const codeRef = useRef(code);
  const kindRef = useRef(kind);
  const annotationsRef = useRef(annotations);
  const commentModeRef = useRef(commentMode);
  const annotationFocusRef = useRef<string | null>(null);
  const generatingRef = useRef(false);
  const applyingCommentsRef = useRef(false);
  const contentDirtyRef = useRef(false);
  const contentConflictRef = useRef(false);
  const annotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annotationQueueRef = useRef<CanvasAnnotationOperationQueue | null>(null);
  if (!annotationQueueRef.current) {
    annotationQueueRef.current = new CanvasAnnotationOperationQueue(
      initialPendingAnnotationOperations,
      (pending) => writeCanvasAnnotationOperations(annotationStorage, artifact?.id, pending),
    );
  }
  const inspectorChannelRef = useRef<ReturnType<typeof createCanvasInspectorChannel> | null>(null);
  const inspectorLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onArtifactUpdatedRef = useRef(onArtifactUpdated);
  const acceptedArtifactIdRef = useRef(artifact?.id ?? null);
  const acceptedArtifactUpdatedAtRef = useRef(artifact?.updatedAt ?? "");

  codeRef.current = code;
  kindRef.current = kind;
  annotationsRef.current = annotations;
  commentModeRef.current = commentMode;
  onArtifactUpdatedRef.current = onArtifactUpdated;

  // Context-aware ideas derived from the artifact itself; recomputed only when
  // the code/kind changes (cheap string scans). Paired with the static defaults
  // so the refine space always offers a starting point.
  const generatedSuggestions = useMemo(
    () => generateRefineSuggestions(code, kind),
    [code, kind],
  );

  const inspectorGeneration = useMemo(() => crypto.randomUUID(), [kind, code]);
  const srcDoc = useMemo(
    () => (
      kind === "react"
        ? buildReactSrcDoc(code, inspectorGeneration)
        : buildPreviewSrcDoc(code, inspectorGeneration)
    ),
    [kind, code, inspectorGeneration],
  );

  // The opaque-origin sandbox can only talk back via postMessage; match the
  // message to THIS frame and surface runtime/compile failures as an overlay.
  //
  // Validation invariant (cave-mnz1): the e.source identity check IS the
  // security boundary here, and an e.origin check must NOT be added. The
  // iframe sandbox omits the same-origin flag, so its origin is OPAQUE —
  // its messages arrive with e.origin === "null", and comparing against
  // window.location.origin would silently drop every legitimate message.
  // The source check is also the stronger guarantee: only this exact frame's
  // contentWindow passes, so a hostile embedder of the app can never spoof
  // sandbox-error events. (Audits keep flagging the "missing" origin check —
  // it's deliberate.)
  const synchronizeArtifactSnapshot = useCallback((
    serverArtifact: CanvasArtifact,
    serverArtifacts: CanvasArtifact[],
    pendingOperations: CanvasAnnotationOperation[],
    mode: "annotation" | "content-save" = "annotation",
  ) => {
    const acceptedArtifact = artifactRef.current;
    const reconciliation = mode === "content-save" || !acceptedArtifact
      ? adoptCanvasContentSnapshot(serverArtifact, pendingOperations)
      : reconcileCanvasAnnotationSnapshot({
          acceptedArtifact,
          incomingArtifact: serverArtifact,
          localCode: codeRef.current,
          localKind: kindRef.current,
          pendingOperations,
          contentConflict: contentConflictRef.current,
        });
    const synchronizedArtifacts = serverArtifacts.map((entry) => (
      entry.id === reconciliation.reportedArtifact.id ? reconciliation.reportedArtifact : entry
    ));

    artifactRef.current = reconciliation.acceptedArtifact;
    acceptedArtifactIdRef.current = reconciliation.acceptedArtifact.id;
    acceptedArtifactUpdatedAtRef.current = reconciliation.acceptedArtifact.updatedAt;
    codeRef.current = reconciliation.code;
    kindRef.current = reconciliation.kind;
    annotationsRef.current = reconciliation.annotations;
    contentDirtyRef.current = reconciliation.contentDirty;
    contentConflictRef.current = reconciliation.contentConflict;
    setCode(reconciliation.code);
    setKind(reconciliation.kind);
    setAnnotations(reconciliation.annotations);
    setContentConflict(reconciliation.contentConflict);
    if (reconciliation.contentConflict) setCommentsError(CONTENT_CONFLICT_MESSAGE);
    onArtifactUpdatedRef.current?.(reconciliation.reportedArtifact, synchronizedArtifacts);
  }, []);

  const markLocalContentChanged = useCallback((nextCode: string, nextKind: ArtifactKind) => {
    codeRef.current = nextCode;
    kindRef.current = nextKind;
    contentDirtyRef.current = artifactRef.current
      ? canvasContentDiffers(artifactRef.current, nextCode, nextKind)
      : false;
  }, []);

  const sendAnnotationOperation = useCallback(async (operation: CanvasAnnotationOperation) => {
    const res = await fetch("/api/canvas", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(operation),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      artifact?: CanvasArtifact;
      artifacts?: CanvasArtifact[];
    };
    if (data.artifact) {
      synchronizeArtifactSnapshot(
        data.artifact,
        data.artifacts ?? [],
        annotationQueueRef.current?.pendingAfterActive() ?? [],
      );
    }
  }, [synchronizeArtifactSnapshot]);

  const drainAnnotationWrites = useCallback(async () => {
    const drained = await annotationQueueRef.current!.drain(sendAnnotationOperation);
    if (mountedRef.current) {
      setCommentsSaveError(
        drained
          ? null
          : "Couldn't save comments. Check your connection, then retry.",
      );
    }
    return drained;
  }, [sendAnnotationOperation]);

  const retryAnnotationWrites = useCallback(async () => {
    const drained = await annotationQueueRef.current!.retry(sendAnnotationOperation);
    if (mountedRef.current) {
      setCommentsSaveError(
        drained
          ? null
          : "Couldn't save comments. Check your connection, then retry.",
      );
    }
  }, [sendAnnotationOperation]);

  const flushAnnotationWrites = useCallback(() => {
    if (annotationTimerRef.current) {
      clearTimeout(annotationTimerRef.current);
      annotationTimerRef.current = null;
    }
    return drainAnnotationWrites();
  }, [drainAnnotationWrites]);

  const updateAnnotations = useCallback((
    next: CanvasAnnotation[],
    operation: CanvasAnnotationOperation,
  ) => {
    annotationsRef.current = next;
    setAnnotations(next);
    annotationQueueRef.current!.enqueue(operation);
    if (annotationTimerRef.current) clearTimeout(annotationTimerRef.current);
    annotationTimerRef.current = setTimeout(() => {
      annotationTimerRef.current = null;
      void drainAnnotationWrites();
    }, 350);
  }, [drainAnnotationWrites]);

  // A reopened viewer can mount from the gallery's pre-flush snapshot. Reconcile
  // a later same-artifact prop without replacing dirty local content; the
  // accepted timestamp prevents an older response from rolling local work back.
  useEffect(() => {
    if (!artifact || artifact.id !== acceptedArtifactIdRef.current) return;
    if (annotationQueueRef.current!.size > 0) return;
    const incomingUpdatedAt = artifact.updatedAt;
    if (!incomingUpdatedAt || incomingUpdatedAt <= acceptedArtifactUpdatedAtRef.current) return;
    const reconciliation = reconcileCanvasAnnotationSnapshot({
      acceptedArtifact: artifactRef.current ?? artifact,
      incomingArtifact: artifact,
      localCode: codeRef.current,
      localKind: kindRef.current,
      pendingOperations: [],
      contentConflict: contentConflictRef.current,
    });
    artifactRef.current = reconciliation.acceptedArtifact;
    acceptedArtifactUpdatedAtRef.current = reconciliation.acceptedArtifact.updatedAt;
    codeRef.current = reconciliation.code;
    kindRef.current = reconciliation.kind;
    annotationsRef.current = reconciliation.annotations;
    contentDirtyRef.current = reconciliation.contentDirty;
    contentConflictRef.current = reconciliation.contentConflict;
    annotationFocusRef.current = null;
    setCode(reconciliation.code);
    setKind(reconciliation.kind);
    setAnnotations(reconciliation.annotations);
    setContentConflict(reconciliation.contentConflict);
    setCommentsError(reconciliation.contentConflict ? CONTENT_CONFLICT_MESSAGE : null);
  }, [artifact]);

  // Retry navigation-durable writes on mount. Teardown only snapshots the local
  // queue synchronously; network work during unmount is unordered and unobservable.
  useEffect(() => {
    mountedRef.current = true;
    if (annotationQueueRef.current!.size > 0) void drainAnnotationWrites();
    return () => {
      mountedRef.current = false;
      refineAbortRef.current?.abort();
      writeCanvasAnnotationOperations(
        annotationStorage,
        artifact?.id,
        annotationQueueRef.current!.pending(),
      );
      inspectorChannelRef.current?.dispose();
      inspectorChannelRef.current = null;
      if (inspectorLoadTimerRef.current) clearTimeout(inspectorLoadTimerRef.current);
      inspectorLoadTimerRef.current = null;
    };
  }, [annotationStorage, artifact?.id, drainAnnotationWrites]);

  const postInspectorState = useCallback((enabled: boolean) => {
    try {
      inspectorChannelRef.current?.setEnabled(enabled);
    } catch {
      // A srcdoc navigation may close the previous port between render and load.
    }
  }, []);

  const acceptInspectorSelection = useCallback((value: unknown) => {
    if (
      !artifactRef.current
      || !commentModeRef.current
      || applyingCommentsRef.current
      || !isCanvasComponentSelectedMessage(value)
    ) {
      return;
    }
    const target = sanitizeCanvasComponentTarget(value.target);
    if (!target) return;
    const now = new Date().toISOString();
    const next = upsertCanvasAnnotationDraft(annotationsRef.current, target, {
      id: `annotation-${crypto.randomUUID()}`,
      now,
    });
    const focused = next.find(
      (annotation) => sanitizeCanvasComponentTarget(annotation.target)?.selector === target.selector,
    );
    annotationFocusRef.current = focused?.id ?? null;
    setSelectionAnnouncement(`Selected ${target.label || target.selector}. Comment field ready.`);
    if (next !== annotationsRef.current && focused) {
      updateAnnotations(next, { id: artifactRef.current.id, annotation: focused });
    }
  }, [updateAnnotations]);

  useLayoutEffect(() => {
    setInspectorLoaded(false);
    commentModeRef.current = false;
    setCommentMode(false);
    if (tab !== "canvas") return;
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
  }, [acceptInspectorSelection, inspectorGeneration, tab]);

  const handlePreviewLoad = useCallback(() => {
    const channel = inspectorChannelRef.current;
    const status = channel?.handleFrameLoad();
    if (status === "authenticated") return;
    const disableInspection = () => {
      if (inspectorChannelRef.current !== channel) return;
      setInspectorLoaded(false);
      commentModeRef.current = false;
      setCommentMode(false);
      setRuntimeError(
        "The artifact navigated away from its preview. Reload or reopen the preview before adding comments.",
      );
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

  const toggleCommentMode = useCallback(() => {
    if (!artifactRef.current || !inspectorLoaded) return;
    const enabled = !commentModeRef.current;
    commentModeRef.current = enabled;
    setCommentMode(enabled);
    postInspectorState(enabled);
  }, [inspectorLoaded, postInspectorState]);

  useEffect(() => {
    setRuntimeError(null);
    function onMessage(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === "sandbox-error" && typeof e.data.message === "string") {
        setRuntimeError(e.data.message);
        return;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc]);

  // Fullscreen is a modal dialog: trap focus inside it, restore focus to the
  // Expand button on close, and close on Escape (shared convention).
  useFocusTrap(fullscreen, shellRef, { onEscape: () => setFullscreen(false) });

  const copyCode = useCallback(() => {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
  }, [code]);

  const openInBrowser = useCallback(() => {
    // Keep untrusted artifact HTML out of Cave's origin, and actually open —
    // blob:/object URLs would inherit the privileged app origin, while the
    // previous top-level data: URL was silently blocked as a navigation by
    // every engine (cave-e3ia). The carrier confines the artifact to a
    // sandboxed opaque-origin srcdoc iframe, same boundary as the preview.
    if (!openArtifactInTab(srcDoc)) {
      setRuntimeError("Pop-up blocked — allow pop-ups for Cave to open the artifact in a tab.");
    }
  }, [srcDoc]);

  const runRefine = useCallback(async () => {
    const ask = refineText.trim();
    if (!ask || !familiarId || generatingRef.current || applyingCommentsRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setRuntimeError(null);
    const ctrl = new AbortController();
    refineAbortRef.current = ctrl;
    try {
      const result = await generateArtifactCode({
        prompt: buildRefinePrompt(code, ask, kind),
        familiarId,
        signal: ctrl.signal,
      });
      if (result.code) {
        const nextCode = clampArtifactCode(result.code);
        const nextKind = result.kind ?? kindRef.current;
        markLocalContentChanged(nextCode, nextKind);
        setCode(nextCode);
        setKind(nextKind);
        setRefineText("");
        setRefineOpen(false);
        setEditing(false);
        setTab("canvas");
        setSaveState("idle");
      } else if (result.error !== "cancelled") {
        setRuntimeError(result.error || "Refine failed — try a different description.");
      }
    } catch (err) {
      // generateArtifactCode converts stream failures to results, but keep a
      // belt here — an uncaught rejection used to wedge "Refining…" forever
      // with every control disabled (cave-v35w).
      setRuntimeError((err as Error)?.message ?? "Refine failed — the connection dropped.");
    } finally {
      refineAbortRef.current = null;
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [refineText, familiarId, code, kind, markLocalContentChanged]);

  const cancelRefine = useCallback(() => {
    refineAbortRef.current?.abort();
  }, []);

  const applyComments = useCallback(async () => {
    if (!artifact || generatingRef.current || applyingCommentsRef.current) return;
    if (contentConflictRef.current) {
      setCommentsError(CONTENT_CONFLICT_MESSAGE);
      return;
    }
    if (!familiarId) {
      setCommentsError("Pick a familiar before applying comments.");
      return;
    }
    const { prompt: commentsPrompt, resolvedAnnotations } = buildCanvasCommentsRequest(annotationsRef.current);
    if (!commentsPrompt) {
      setCommentsError("Add a requested change to at least one comment.");
      return;
    }
    applyingCommentsRef.current = true;
    setApplyingComments(true);
    setCommentsError(null);
    setCommentsRecovery(null);
    setRuntimeError(null);
    const annotationsSaved = await flushAnnotationWrites();
    if (!mountedRef.current) {
      applyingCommentsRef.current = false;
      return;
    }
    if (!annotationsSaved) {
      applyingCommentsRef.current = false;
      setApplyingComments(false);
      return;
    }
    if (contentConflictRef.current) {
      applyingCommentsRef.current = false;
      setApplyingComments(false);
      setCommentsError(CONTENT_CONFLICT_MESSAGE);
      return;
    }
    const persistedArtifact = artifactRef.current;
    if (!persistedArtifact) {
      applyingCommentsRef.current = false;
      setApplyingComments(false);
      return;
    }
    const codeSnapshot = codeRef.current;
    const kindSnapshot = kindRef.current;
    const expectedUpdatedAt = persistedArtifact.updatedAt;
    const ctrl = new AbortController();
    refineAbortRef.current = ctrl;
    try {
      const result = await generateArtifactCode({
        familiarId,
        prompt: buildRefinePrompt(codeSnapshot, commentsPrompt, kindSnapshot),
        signal: ctrl.signal,
      });
      if (!mountedRef.current || ctrl.signal.aborted || result.error === "cancelled") return;
      if (result.error) {
        setCommentsError(`Couldn't apply comments: ${result.error}. Your comments were kept; try again.`);
        return;
      }
      if (!result.code) {
        setCommentsError("Couldn't apply comments: the familiar returned no artifact. Your comments were kept; try again.");
        return;
      }
      const nextCode = clampArtifactCode(result.code);
      const nextKind = result.kind ?? kindRef.current;
      const revisedArtifact: CanvasArtifact = {
        ...persistedArtifact,
        id: persistedArtifact.id,
        code: nextCode,
        kind: nextKind,
        createdAt: persistedArtifact.createdAt,
        updatedAt: new Date().toISOString(),
        annotations: [],
      };
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact: revisedArtifact, expectedUpdatedAt, resolvedAnnotations }),
      });
      if (res.status === 404 || res.status === 409) {
        if (nextCode !== codeSnapshot) {
          setCommentsRecovery({ code: nextCode, kind: nextKind });
        }
        setCommentsError(
          res.status === 404
            ? "This artifact was deleted while comments were being applied. Reopen Canvas and retry on the current artifact. Your comments are still here."
            : "This artifact changed while comments were being applied. Reopen the preview and retry on the current version. Your comments are still here.",
        );
        return;
      }
      if (!res.ok) throw new Error(`canvas store ${res.status}`);
      const data = (await res.json()) as {
        artifact?: CanvasArtifact;
        artifacts?: CanvasArtifact[];
      };
      const savedArtifact = data.artifact;
      if (!savedArtifact) throw new Error("canvas store returned no artifact");
      annotationQueueRef.current!.reset();
      if (annotationTimerRef.current) {
        clearTimeout(annotationTimerRef.current);
        annotationTimerRef.current = null;
      }
      synchronizeArtifactSnapshot(savedArtifact, data.artifacts ?? [], [], "content-save");
      annotationFocusRef.current = null;
      setCommentMode(false);
      commentModeRef.current = false;
      postInspectorState(false);
      setTab("canvas");
      setEditing(false);
      setSaveState("idle");
      setCommentsRecovery(null);
    } catch (err) {
      setCommentsError(`Couldn't apply comments: ${(err as Error)?.message || "the request failed"}. Your comments were kept; try again.`);
    } finally {
      refineAbortRef.current = null;
      applyingCommentsRef.current = false;
      setApplyingComments(false);
    }
  }, [artifact, familiarId, flushAnnotationWrites, postInspectorState, synchronizeArtifactSnapshot]);

  const openRefine = useCallback(() => {
    if (!familiarId || applyingCommentsRef.current) return;
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

  const shell = (
    <div
      ref={shellRef}
      className={`chat-artifact${fullscreen ? " chat-artifact--fullscreen" : ""}`}
      {...(fullscreen ? { role: "dialog" as const, "aria-modal": true, "aria-label": "Artifact (fullscreen)", tabIndex: -1 } : {})}
    >
      <div className="chat-artifact__head">
        <span className="chat-artifact__dots" aria-hidden>
          <i className="chat-artifact__dot chat-artifact__dot--danger" />
          <i className="chat-artifact__dot chat-artifact__dot--warning" />
          <i className="chat-artifact__dot chat-artifact__dot--success" />
        </span>
        <Tabs
          variant="segment"
          size="sm"
          ariaLabel="Artifact view"
          value={tab}
          onChange={setTab}
          items={[
            { id: "canvas", label: "Canvas", icon: "ph:squares-four" },
            { id: "code", label: "Code", icon: "ph:code" },
          ]}
        />
        <span className="chat-artifact__title" title={title}>{title}</span>
        <span className="chat-artifact__spacer" />
        <div className="chat-artifact__actions">
          {artifact ? (
            <button
              type="button"
              className={`chat-artifact__btn chat-artifact__btn--text${commentMode ? " is-active" : ""}`}
              title={commentMode ? "Stop commenting" : "Comment on components"}
              aria-label="Comment mode"
              aria-pressed={commentMode}
              disabled={applyingComments || !inspectorLoaded}
              onClick={toggleCommentMode}
            >
              <Icon name="ph:chat-circle-dots" width={14} aria-hidden />
              Comment{annotations.length > 0 ? ` (${annotations.length})` : ""}
            </button>
          ) : null}
          {tab === "code" ? (
            <button type="button" className={`chat-artifact__btn${editing ? " is-active" : ""}`} title="Edit code" aria-label="Edit code" disabled={generating || applyingComments} onClick={() => setEditing((v) => !v)}>
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
            <span className="chat-artifact__btn chat-artifact__btn--text" aria-live="polite">
              <Icon name="ph:check" width={13} /> Saved to Canvas
            </span>
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
              onLoad={handlePreviewLoad}
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
            disabled={generating || applyingComments}
            onChange={(e) => {
              markLocalContentChanged(e.target.value, kindRef.current);
              setCode(e.target.value);
              setSaveState("idle");
            }}
          />
        ) : (
          <ArtifactCode code={code} kind={kind} />
        )}
      </div>

      {artifact && (commentMode || annotations.length > 0 || commentsSaveError) ? (
        <div className="chat-artifact__comments" role="region" aria-label="Component comments">
          <div className="chat-artifact__comments-head">
            <span className="chat-artifact__comments-title">Component comments</span>
            <span className="chat-artifact__comments-hint">
              {commentMode
                ? "Click a component, or focus one in the preview and press Enter or Space."
                : "Comment mode is paused."}
            </span>
            <span className="sr-only" aria-live="polite">{selectionAnnouncement}</span>
          </div>
          {annotations.length > 0 ? (
            <ul className="chat-artifact__comments-list">
              {annotations.map((annotation) => (
                <li key={annotation.id} className="chat-artifact__comment">
                  <div className="chat-artifact__comment-target">
                    <strong>{annotation.target.label || "Unlabelled component"}</strong>
                    <code>{annotation.target.selector}</code>
                  </div>
                  <div className="chat-artifact__comment-row">
                    <textarea
                      ref={(element) => {
                        if (element && annotationFocusRef.current === annotation.id) {
                          annotationFocusRef.current = null;
                          element.focus();
                        }
                      }}
                      className="chat-artifact__comment-note"
                      aria-label={`Comment on ${annotation.target.label || annotation.target.selector}`}
                      placeholder="Describe the change you want…"
                      rows={2}
                      value={annotation.note}
                      disabled={applyingComments}
                      onChange={(event) => {
                        const next = replaceCanvasAnnotationNote(
                          annotationsRef.current,
                          annotation.id,
                          event.target.value,
                          new Date().toISOString(),
                        );
                        const updated = next.find((entry) => entry.id === annotation.id);
                        if (updated) updateAnnotations(next, { id: artifact.id, annotation: updated });
                      }}
                    />
                    <button
                      type="button"
                      className="chat-artifact__comment-remove"
                      aria-label={`Remove comment on ${annotation.target.label || annotation.target.selector}`}
                      title="Remove comment"
                      disabled={applyingComments}
                      onClick={() => {
                        updateAnnotations(
                          removeCanvasAnnotationDraft(annotationsRef.current, annotation.id),
                          { id: artifact.id, removeAnnotationId: annotation.id },
                        );
                        if (annotationFocusRef.current === annotation.id) annotationFocusRef.current = null;
                      }}
                    >
                      <Icon name="ph:trash" width={14} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chat-artifact__comments-empty">No components selected yet.</p>
          )}
          {commentsSaveError ? (
            <div className="chat-artifact__comments-save-error" role="alert">
              <span>{commentsSaveError}</span>
              <button
                type="button"
                className="chat-artifact__comments-retry"
                onClick={() => void retryAnnotationWrites()}
              >
                Retry saving comments
              </button>
            </div>
          ) : null}
          {commentsError ? <p className="chat-artifact__comments-error" role="alert">{commentsError}</p> : null}
          {commentsRecovery ? (
            <div className="chat-artifact__comments-recovery">
              <span>Generated draft wasn&apos;t saved ({commentsRecovery.kind}).</span>
              <button
                type="button"
                className="chat-artifact__btn chat-artifact__btn--text"
                onClick={() => void navigator.clipboard?.writeText(commentsRecovery.code).catch(() => undefined)}
              >
                Copy generated code
              </button>
            </div>
          ) : null}
          <div className="chat-artifact__comments-foot">
            {!familiarId ? <span>Pick a familiar to apply comments.</span> : null}
            <span className="chat-artifact__spacer" />
            <button
              type="button"
              className="chat-artifact__comments-apply"
              disabled={contentConflict || applyingComments || generating || !familiarId || !annotations.some((annotation) => annotation.note.trim())}
              onClick={() => void applyComments()}
            >
              <Icon name="ph:sparkle" width={14} aria-hidden />
              {applyingComments ? "Applying…" : "Apply comments"}
            </button>
          </div>
        </div>
      ) : null}

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
            disabled={generating || applyingComments}
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
                  disabled={generating || applyingComments}
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
                      disabled={generating || applyingComments}
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
            <button
              type="button"
              className="chat-artifact__btn chat-artifact__btn--text"
              onClick={() => (generating ? cancelRefine() : setRefineOpen(false))}
            >
              {generating ? "Stop" : "Cancel"}
            </button>
            <button
              type="button"
              className="chat-artifact__refine-go"
              disabled={generating || applyingComments || !refineText.trim()}
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
          disabled={!familiarId || applyingComments}
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

"use client";

import "@/styles/chat-canvas.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SearchInput } from "@/components/ui/search-input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { CanvasAddTile } from "@/components/canvas-add-tile";
import { CanvasEditor } from "@/components/canvas-editor";
import { buildPreviewSrcDoc, type CanvasArtifact } from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import {
  filterCanvasArtifacts,
  formatArtifactWhen,
  galleryArtifactKind,
  isCanvasGalleryLoadCurrent,
  mergeCanvasArtifactSnapshot,
  sortArtifactsForGallery,
  type CanvasArtifactSnapshotMutation,
  type CanvasKindFilter,
} from "@/lib/canvas-gallery";

// The Canvas tab: the gallery for sketches saved from chat ("Save to Canvas"
// in the inline artifact viewer persists to ~/.coven/cave/canvas.json via
// /api/canvas). Until this tab, saved artifacts had no surface after the
// standalone Canvas page retired — save was a one-way door. This closes the
// loop: browse saved sketches (toolbar search + kind filter), click one for a
// non-interactive preview modal, open it in the full-surface Canvas editor,
// or delete it.

type LoadState = "loading" | "ready" | "error";

const KIND_FILTERS: { id: CanvasKindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "react", label: "React" },
  { id: "html", label: "HTML" },
];

export function ChatCanvasView({ familiarId }: { familiarId: string | null }) {
  const [artifacts, setArtifacts] = useState<CanvasArtifact[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<CanvasKindFilter>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeComposerId, setActiveComposerId] = useState<string | null>(null);
  // Bumped by the toolbar's "New sketch" button; the add tile expands on change.
  const [addExpandRequest, setAddExpandRequest] = useState(0);
  const confirm = useConfirm();
  const artifactVersionRef = useRef(0);
  const loadRequestTokenRef = useRef(0);
  const deletedArtifactIdsRef = useRef(new Set<string>());
  const previewDialogRef = useRef<HTMLDivElement | null>(null);
  // The delete confirm dialog stacks its own focus trap over the preview's.
  // Escape there must settle the confirm, not also dismiss the preview.
  const confirmingDeleteRef = useRef(false);

  // The id a just-kept sketch settles in with — drives a one-shot highlight.
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const acceptArtifacts = useCallback((
    next: CanvasArtifact[],
    mutation: CanvasArtifactSnapshotMutation,
  ) => {
    artifactVersionRef.current += 1;
    if (mutation.kind === "delete") deletedArtifactIdsRef.current.add(mutation.deletedId);
    const sequencedMutation: CanvasArtifactSnapshotMutation = mutation.kind === "upsert"
      ? {
          kind: "upsert",
          changedId: mutation.changedId,
          deletedIds: new Set(deletedArtifactIdsRef.current),
        }
      : mutation;
    setArtifacts((current) => sortArtifactsForGallery(
      mergeCanvasArtifactSnapshot(current, next, sequencedMutation),
    ));
    setState("ready");
  }, []);
  const handleSaved = useCallback((next: CanvasArtifact[], savedId: string) => {
    acceptArtifacts(next, { kind: "upsert", changedId: savedId });
    setJustSavedId(savedId);
    // One-shot: clear after the highlight animation finishes. A stale clear
    // after unmount is harmless.
    setTimeout(() => setJustSavedId((cur) => (cur === savedId ? null : cur)), 2000);
  }, [acceptArtifacts]);
  const handleArtifactUpdated = useCallback((updated: CanvasArtifact, next: CanvasArtifact[]) => {
    acceptArtifacts(next, { kind: "upsert", changedId: updated.id });
  }, [acceptArtifacts]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestToken = ++loadRequestTokenRef.current;
    const startedArtifactVersion = artifactVersionRef.current;
    setState("loading");
    try {
      const res = await fetch("/api/canvas", { signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { artifacts?: CanvasArtifact[] };
      if (!isCanvasGalleryLoadCurrent(
        startedArtifactVersion,
        requestToken,
        artifactVersionRef.current,
        loadRequestTokenRef.current,
      )) return;
      setArtifacts(sortArtifactsForGallery(data.artifacts ?? []));
      setState("ready");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      if (!isCanvasGalleryLoadCurrent(
        startedArtifactVersion,
        requestToken,
        artifactVersionRef.current,
        loadRequestTokenRef.current,
      )) return;
      setState("error");
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const remove = useCallback(
    async (artifact: CanvasArtifact) => {
      confirmingDeleteRef.current = true;
      const ok = await confirm({
        title: "Delete sketch?",
        body: `"${artifact.title}" is removed from the Canvas permanently. Sketches already posted in chats stay in those transcripts.`,
        confirmLabel: "Delete",
        danger: true,
      });
      confirmingDeleteRef.current = false;
      if (!ok) return;
      setDeletingId(artifact.id);
      try {
        const res = await fetch("/api/canvas", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: artifact.id }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { artifacts?: CanvasArtifact[] };
        acceptArtifacts(data.artifacts ?? [], { kind: "delete", deletedId: artifact.id });
        setPreviewId((current) => (current === artifact.id ? null : current));
      } catch {
        // Keep the card; a transient failure shouldn't silently drop it from
        // view while it still exists in the store.
      } finally {
        setDeletingId(null);
      }
    },
    [acceptArtifacts, confirm],
  );

  const preview = useMemo(
    () => (previewId ? (artifacts.find((a) => a.id === previewId) ?? null) : null),
    [previewId, artifacts],
  );
  const editing = useMemo(
    () => (editorId ? (artifacts.find((a) => a.id === editorId) ?? null) : null),
    [editorId, artifacts],
  );

  useFocusTrap(preview !== null, previewDialogRef, {
    onEscape: () => {
      if (!confirmingDeleteRef.current) setPreviewId(null);
    },
  });

  const galleryArtifacts = useMemo(
    () => activeComposerId ? artifacts.filter((artifact) => artifact.id !== activeComposerId) : artifacts,
    [activeComposerId, artifacts],
  );
  const filteredArtifacts = useMemo(
    () => filterCanvasArtifacts(galleryArtifacts, q, kindFilter),
    [galleryArtifacts, q, kindFilter],
  );

  if (state === "error") {
    return (
      <div className="chat-canvas-view flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <ErrorState
          headline="Couldn't load the Canvas"
          subtitle="The canvas store didn't respond."
          actions={<Button onClick={() => void load()}>Retry</Button>}
        />
      </div>
    );
  }

  if (artifacts.length === 0 && state === "loading") {
    return (
      <div className="chat-canvas-view flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <EmptyState
          icon="ph:hourglass"
          headline="Loading saved sketches..."
          subtitle="Fetching saved sketches from the canvas store..."
        />
      </div>
    );
  }

  // Full-surface takeover: the editor replaces toolbar + grid until closed.
  if (editing) {
    return (
      <CanvasEditor
        artifact={editing}
        familiarId={familiarId}
        onClose={() => setEditorId(null)}
        onArtifactUpdated={handleArtifactUpdated}
      />
    );
  }

  const trimmedQuery = q.trim();

  return (
    <div className="chat-canvas-view flex min-h-0 min-w-0 flex-1 flex-col">
      {galleryArtifacts.length > 0 ? (
        <div className="chat-canvas-toolbar">
          <SearchInput
            containerClassName="chat-canvas-toolbar__search"
            value={q}
            onValueChange={setQ}
            onClear={() => setQ("")}
            placeholder="Search sketches…"
            aria-label="Search sketches"
          />
          <div className="chat-canvas-toolbar__filter" role="group" aria-label="Filter sketches by kind">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chat-canvas-toolbar__filter-btn focus-ring-inset"
                aria-pressed={kindFilter === f.id}
                onClick={() => setKindFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="chat-canvas-toolbar__count" aria-live="polite">
            {filteredArtifacts.length} of {galleryArtifacts.length} sketches
          </span>
          <button
            type="button"
            className="chat-canvas-toolbar__new focus-ring"
            onClick={() => setAddExpandRequest((n) => n + 1)}
          >
            <Icon name="ph:plus-bold" width={14} aria-hidden /> New sketch
          </button>
        </div>
      ) : null}
      <div className="chat-canvas-scroll">
        <div className="chat-canvas-grid" role="list" aria-label="Saved sketches" aria-busy={state === "loading"}>
          {/* One stable tree position across empty<->populated so crossing zero
              never remounts the composer (which would wipe typed input and
              abort an in-flight generation). Empty gallery = hero-styled tile:
              the add tile IS the empty state. The tile always leads the grid
              regardless of the active search/filter. */}
          <CanvasAddTile
            hero={galleryArtifacts.length === 0}
            familiarId={familiarId}
            expandRequest={addExpandRequest}
            onArtifactsChanged={handleSaved}
            onActiveArtifactChange={setActiveComposerId}
          />
          {filteredArtifacts.map((artifact) => {
            const srcDoc =
              artifact.kind === "react" ? buildReactSrcDoc(artifact.code) : buildPreviewSrcDoc(artifact.code);
            return (
              <div
                key={artifact.id}
                role="listitem"
                className={`chat-canvas-card${artifact.id === justSavedId ? " chat-canvas-card--new" : ""}${artifact.id === previewId ? " chat-canvas-card--selected" : ""}`}
              >
                <button
                  type="button"
                  className="chat-canvas-card__open focus-ring"
                  aria-label={`Open sketch: ${artifact.title}`}
                  onClick={() => setPreviewId(artifact.id)}
                >
                  <span className="chat-canvas-card__thumb" aria-hidden>
                    {/* Non-interactive thumbnail: same opaque-origin sandbox as the
                        inline viewer, minus popups/modals — it's just a picture here. */}
                    <iframe
                      className="chat-canvas-card__frame"
                      title={`Preview of ${artifact.title}`}
                      sandbox="allow-scripts"
                      loading="lazy"
                      srcDoc={srcDoc}
                      tabIndex={-1}
                    />
                  </span>
                </button>
                <div className="chat-canvas-card__meta">
                  <span className="chat-canvas-card__title" title={artifact.prompt || artifact.title}>
                    {artifact.title}
                  </span>
                  <span className="chat-canvas-card__sub">
                    {galleryArtifactKind(artifact) === "react" ? "React" : "HTML"}
                    {(() => { const when = formatArtifactWhen(artifact.updatedAt); return when ? ` · ${when}` : ""; })()}
                  </span>
                  <button
                    type="button"
                    className="chat-canvas-card__delete focus-ring"
                    aria-label={`Delete sketch: ${artifact.title}`}
                    title="Delete sketch"
                    disabled={deletingId === artifact.id}
                    onClick={() => void remove(artifact)}
                  >
                    <Icon name="ph:trash" width={13} aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {filteredArtifacts.length === 0 && galleryArtifacts.length > 0 ? (
          <p className="chat-canvas-filter-empty" role="status">
            {trimmedQuery
              ? <>No sketches match &ldquo;{trimmedQuery}&rdquo;</>
              : `No ${kindFilter === "react" ? "React" : "HTML"} sketches yet.`}
          </p>
        ) : null}
        {artifacts.length === 0 ? (
          <p className="chat-canvas-add__hint">
            Sketches also arrive from chat — <code>/canvas a pricing page with three tiers</code>, then "Save to Canvas".
          </p>
        ) : null}
      </div>
      {/* Preview modal: the sketch rendered live but non-interactive. Running
          it for real (and refining/commenting) happens in the editor. */}
      {preview ? (
        <div
          className="chat-canvas-preview-backdrop"
          role="presentation"
          onClick={() => setPreviewId(null)}
        >
          <div
            ref={previewDialogRef}
            className="chat-canvas-preview"
            role="dialog"
            aria-modal="true"
            aria-label={`Sketch preview: ${preview.title}`}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="chat-canvas-preview__head">
              <span className="chat-canvas-preview__title" title={preview.title}>{preview.title}</span>
              <span className="chat-canvas-preview__tag">
                {galleryArtifactKind(preview) === "react" ? "React" : "HTML"}
                {(() => { const when = formatArtifactWhen(preview.updatedAt); return when ? ` · ${when}` : ""; })()}
              </span>
              <button
                type="button"
                className="chat-canvas-preview__close focus-ring"
                aria-label="Close preview"
                onClick={() => setPreviewId(null)}
              >
                <Icon name="ph:x" width={15} aria-hidden />
              </button>
            </header>
            <div className="chat-canvas-preview__body">
              <iframe
                className="chat-canvas-preview__frame"
                title={`Preview of ${preview.title}`}
                sandbox="allow-scripts"
                srcDoc={preview.kind === "react" ? buildReactSrcDoc(preview.code) : buildPreviewSrcDoc(preview.code)}
                tabIndex={-1}
              />
            </div>
            <p className="chat-canvas-preview__hint">
              Sketch preview — open it in the editor to run it live.
            </p>
            <footer className="chat-canvas-preview__foot">
              <Button
                variant="ghost"
                onClick={() => void remove(preview)}
                disabled={deletingId === preview.id}
              >
                Delete
              </Button>
              <span className="chat-canvas-preview__spacer" />
              <Button variant="secondary" onClick={() => setPreviewId(null)}>Close</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setEditorId(preview.id);
                  setPreviewId(null);
                }}
              >
                Open in editor
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

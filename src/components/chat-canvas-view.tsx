"use client";

import "@/styles/chat-artifact.css";
import "@/styles/chat-canvas.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ChatArtifactViewer } from "@/components/chat-artifact-viewer";
import { buildPreviewSrcDoc, type CanvasArtifact } from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import { formatArtifactWhen, sortArtifactsForGallery } from "@/lib/canvas-gallery";

// The Canvas tab: the gallery for sketches saved from chat ("Save to Canvas"
// in the inline artifact viewer persists to ~/.coven/cave/canvas.json via
// /api/canvas). Until this tab, saved artifacts had no surface after the
// standalone Canvas page retired — save was a one-way door. This closes the
// loop: browse saved sketches, reopen one in the full viewer (preview / code /
// refine), or delete it.

type LoadState = "loading" | "ready" | "error";

export function ChatCanvasView({ familiarId }: { familiarId: string | null }) {
  const [artifacts, setArtifacts] = useState<CanvasArtifact[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const res = await fetch("/api/canvas", { signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { artifacts?: CanvasArtifact[] };
      setArtifacts(sortArtifactsForGallery(data.artifacts ?? []));
      setState("ready");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
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
      const ok = await confirm({
        title: "Delete sketch?",
        body: `"${artifact.title}" is removed from the Canvas permanently. Sketches already posted in chats stay in those transcripts.`,
        confirmLabel: "Delete",
        danger: true,
      });
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
        setArtifacts(sortArtifactsForGallery(data.artifacts ?? []));
        setOpenId((current) => (current === artifact.id ? null : current));
      } catch {
        // Keep the card; a transient failure shouldn't silently drop it from
        // view while it still exists in the store.
      } finally {
        setDeletingId(null);
      }
    },
    [confirm],
  );

  const opened = useMemo(
    () => (openId ? (artifacts.find((a) => a.id === openId) ?? null) : null),
    [openId, artifacts],
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

  if (state === "ready" && artifacts.length === 0) {
    return (
      <div className="chat-canvas-view flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <EmptyState
          icon="ph:paint-brush"
          headline="No saved sketches yet"
          subtitle={
            <>
              Ask for one in a chat — e.g. <code>/canvas a pricing page with three tiers</code> — then
              use “Save to Canvas” on the result.
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="chat-canvas-view flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="chat-canvas-grid" role="list" aria-label="Saved sketches" aria-busy={state === "loading"}>
        {artifacts.map((artifact) => {
          const srcDoc =
            artifact.kind === "react" ? buildReactSrcDoc(artifact.code) : buildPreviewSrcDoc(artifact.code);
          return (
            <div key={artifact.id} role="listitem" className="chat-canvas-card">
              <button
                type="button"
                className="chat-canvas-card__open focus-ring"
                aria-label={`Open sketch: ${artifact.title}`}
                onClick={() => setOpenId(artifact.id)}
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
                  {artifact.kind === "react" ? "React" : "HTML"}
                  {formatArtifactWhen(artifact.updatedAt) ? ` · ${formatArtifactWhen(artifact.updatedAt)}` : ""}
                </span>
                <button
                  type="button"
                  className="chat-canvas-card__delete focus-ring"
                  aria-label={`Delete sketch: ${artifact.title}`}
                  title="Delete sketch"
                  disabled={deletingId === artifact.id}
                  onClick={() => void remove(artifact)}
                >
                  <Icon name="ph:trash" width={14} aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {/* Reopen a saved sketch in the full inline viewer (preview/code tabs,
          refine, fullscreen). Refine edits live in the modal only; "Save to
          Canvas" from the viewer stores the refined result as a new sketch. */}
      <Modal
        open={opened !== null}
        onClose={() => setOpenId(null)}
        breadcrumb={["Canvas", opened?.title ?? ""]}
        wide
      >
        {opened ? (
          <div className="chat-canvas-modal-body">
            <ChatArtifactViewer
              key={opened.id}
              initialCode={opened.code}
              kind={opened.kind ?? "html"}
              title={opened.title}
              familiarId={familiarId}
              sourcePrompt={opened.prompt}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

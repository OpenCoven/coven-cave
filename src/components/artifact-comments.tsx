"use client";

/**
 * ArtifactComments — lets a user annotate a markdown artifact an agent produced
 * in chat (select any passage → leave a comment), then request a revision that
 * sends every comment back to the agent as a single follow-up prompt.
 *
 * Selection is scoped to the turn's rendered markdown
 * (`[data-turn-id="…"] .cave-artifact-content`); comments are held client-side
 * (persisted per-turn to localStorage) and folded into the prompt on request —
 * Cave only persists prompt text, never client turn metadata.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  buildCommentsPrompt,
  clampFabX,
  normalizeExcerpt,
  readComments,
  writeComments,
  type ArtifactComment,
} from "@/lib/artifact-comments";
import "@/styles/artifact-comments.css";

type FloatingSel = { text: string; x: number; y: number };

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

export function ArtifactComments({
  turnId,
  familiarName,
  onRequest,
}: {
  turnId: string;
  familiarName: string;
  /** Submit the synthesized revision prompt to the agent (wired to chat send). */
  onRequest: (prompt: string) => void;
}) {
  const [comments, setComments] = useState<ArtifactComment[]>(() => readComments(turnId));
  const [sel, setSel] = useState<FloatingSel | null>(null);
  const [requested, setRequested] = useState(false);
  const focusIdRef = useRef<string | null>(null);
  const noteRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  // Persist per-turn so an accidental reload doesn't drop in-progress comments.
  useEffect(() => {
    writeComments(turnId, comments);
  }, [turnId, comments]);

  // Detect a text selection inside THIS turn's rendered markdown and surface a
  // floating "Comment" affordance anchored to it.
  useEffect(() => {
    const content = () =>
      document.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(turnId)}"] .cave-artifact-content`);
    const within = (node: Node | null, root: HTMLElement | null) =>
      !!node && !!root && root.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);

    const onMouseUp = () => {
      // Defer so the selection has settled after the mouseup.
      window.setTimeout(() => {
        const root = content();
        const selection = window.getSelection();
        if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
          setSel(null);
          return;
        }
        const text = selection.toString().trim();
        if (text.length < 3 || !within(selection.anchorNode, root) || !within(selection.focusNode, root)) {
          setSel(null);
          return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        // Clamp so the pill never clips off either viewport edge on wide selections.
        setSel({ text, x: clampFabX(rect.left + rect.width / 2, window.innerWidth), y: rect.top });
      }, 0);
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setSel(null);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [turnId]);

  // Keep the pill anchored to the TEXT, not the viewport: the fab is
  // position:fixed at coords captured on mouseup, so scrolling the chat left
  // it hovering over unrelated prose mid-response (issue #2997). While the
  // pill is up, recompute its position from the live selection range on any
  // scroll (capture phase — the chat scrolls in an inner container) or
  // resize; it now travels with — and off-screen with — its selection.
  const fabVisible = sel !== null;
  useEffect(() => {
    if (!fabVisible) return;
    let raf = 0;
    const reposition = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          setSel(null);
          return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          setSel(null);
          return;
        }
        setSel((prev) =>
          prev ? { ...prev, x: clampFabX(rect.left + rect.width / 2, window.innerWidth), y: rect.top } : prev,
        );
      });
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
  }, [fabVisible]);

  // Focus the note field of a freshly added comment.
  useEffect(() => {
    if (!focusIdRef.current) return;
    noteRefs.current.get(focusIdRef.current)?.focus();
    focusIdRef.current = null;
  }, [comments]);

  const addFromSelection = useCallback(() => {
    if (!sel) return;
    const id = newId();
    focusIdRef.current = id;
    setComments((prev) => [...prev, { id, excerpt: normalizeExcerpt(sel.text), note: "" }]);
    setRequested(false);
    setSel(null);
    window.getSelection()?.removeAllRanges();
  }, [sel]);

  const setNote = useCallback((id: string, note: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, note } : c)));
  }, []);

  const removeComment = useCallback((id: string) => {
    noteRefs.current.delete(id);
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const requestRevision = useCallback(() => {
    const prompt = buildCommentsPrompt(comments, { documentLabel: "the document you produced above" });
    if (!prompt) return;
    onRequest(prompt);
    setComments([]);
    setRequested(true);
  }, [comments, onRequest]);

  return (
    <>
      {sel ? (
        <button
          type="button"
          className="cave-artifact-comment-fab"
          style={{ left: `${sel.x}px`, top: `${Math.max(8, sel.y - 42)}px` }}
          // Use mouseDown so the click lands before the selection clears.
          onMouseDown={(e) => {
            e.preventDefault();
            addFromSelection();
          }}
          aria-label="Comment on selection"
        >
          <Icon name="ph:chat-teardrop" width={13} aria-hidden />
          Comment
        </button>
      ) : null}

      {comments.length > 0 ? (
        <div className="cave-artifact-comments" role="group" aria-label="Comments on this document">
          <div className="cave-artifact-comments__head">
            <Icon name="ph:chat-teardrop" width={13} aria-hidden />
            <span>
              {comments.length} comment{comments.length === 1 ? "" : "s"}
            </span>
            <span className="cave-artifact-comments__hint">select text above to add more</span>
          </div>
          <ul className="cave-artifact-comments__list">
            {comments.map((c) => (
              <li key={c.id} className="cave-artifact-comment">
                <blockquote className="cave-artifact-comment__excerpt" title={c.excerpt}>
                  {c.excerpt}
                </blockquote>
                <div className="cave-artifact-comment__row">
                  <textarea
                    ref={(el) => {
                      if (el) noteRefs.current.set(c.id, el);
                      else noteRefs.current.delete(c.id);
                    }}
                    className="cave-artifact-comment__note"
                    value={c.note}
                    onChange={(e) => setNote(c.id, e.target.value)}
                    placeholder="Add a note (what should change?)…"
                    aria-label="Comment note"
                    rows={1}
                  />
                  <button
                    type="button"
                    className="cave-artifact-comment__remove"
                    onClick={() => removeComment(c.id)}
                    aria-label="Remove comment"
                    title="Remove comment"
                  >
                    <Icon name="ph:x" width={11} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="cave-artifact-comments__foot">
            <button
              type="button"
              className="cave-artifact-comments__send"
              onClick={requestRevision}
              aria-label={`Send comments to ${familiarName} and request a revision`}
            >
              <Icon name="ph:arrow-bend-up-left" width={13} aria-hidden />
              Request {familiarName}&rsquo;s revision
            </button>
          </div>
        </div>
      ) : requested ? (
        <div className="cave-artifact-comments__sent" role="status">
          <Icon name="ph:chat-circle-dots" width={12} aria-hidden />
          Sent your comments to {familiarName}.
        </div>
      ) : null}
    </>
  );
}

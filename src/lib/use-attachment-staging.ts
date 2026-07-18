"use client";

import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { fileToAttachment, hasDraggedFiles, type ComposerAttachment } from "@/lib/chat-attachments";

/**
 * Staged file attachments for a composer: paperclip picks, drag-and-drop, and
 * paste-to-attach, capped at `maxFiles`.
 *
 * Why this exists: the chat composer (chat-view.tsx) and the home composer
 * (home-composer.tsx) each hand-rolled the identical staging state — the
 * capped `addFiles`, the enter/leave-counting drag handlers (dragDepth pairs,
 * so child elements never flicker the overlay), and the files-win-over-text
 * paste. One implementation keeps the two composers' capture behavior aligned.
 *
 * What stays per-composer, by design:
 * - the drop target (home: the composer card; chat: the whole section) — the
 *   handlers are returned as a bundle and attached wherever the surface wants;
 * - cap/added feedback via `onLimit`/`onAdded` (home toasts + announces, chat
 *   is silent);
 * - focus-after-add via `focus` (home defers a tick, chat focuses directly);
 * - the file-input markup (accept list, snapshot-then-clear re-pick fix).
 */
export function useAttachmentStaging(opts?: {
  maxFiles?: number;
  /** Called when a pick/drop is entirely swallowed by the cap. */
  onLimit?: () => void;
  /** Called with the number of files actually staged. */
  onAdded?: (count: number) => void;
  /** Return focus to the composer input after files stage. */
  focus?: () => void;
}): {
  attachments: ComposerAttachment[];
  addFiles: (files: FileList | File[] | null) => Promise<void>;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  handlePaste: (e: ClipboardEvent) => void;
  dropActive: boolean;
  dropHandlers: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
} {
  const maxFiles = opts?.maxFiles ?? 10;
  const onLimit = opts?.onLimit;
  const onAdded = opts?.onAdded;
  const focus = opts?.focus;

  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  // dragDepthRef counts enter/leave pairs so moving across child elements
  // never flickers the drop overlay off.
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files?.length) return;
      const room = Math.max(0, maxFiles - attachments.length);
      const selected = Array.from(files).slice(0, room);
      if (selected.length === 0) {
        onLimit?.();
        return;
      }
      const next = await Promise.all(selected.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...next]);
      onAdded?.(next.length);
      focus?.();
    },
    [maxFiles, attachments.length, onLimit, onAdded, focus],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  // Paste-to-attach: clipboard files (screenshots, copied files) win over any
  // text payload riding along. Only preventDefault when files were actually
  // consumed so a plain-text paste is untouched.
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const pastedFiles = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (pastedFiles.length > 0) {
        e.preventDefault();
        void addFiles(pastedFiles);
      }
    },
    [addFiles],
  );

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasDraggedFiles(e.dataTransfer.types)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDropActive(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasDraggedFiles(e.dataTransfer.types)) return;
      e.preventDefault();
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasDraggedFiles(e.dataTransfer.types)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDropActive(false);
    },
    onDrop: (e: DragEvent) => {
      dragDepthRef.current = 0;
      setDropActive(false);
      if (!hasDraggedFiles(e.dataTransfer.types)) return;
      e.preventDefault();
      void addFiles(e.dataTransfer.files);
    },
  };

  return { attachments, addFiles, removeAttachment, clearAttachments, handlePaste, dropActive, dropHandlers };
}

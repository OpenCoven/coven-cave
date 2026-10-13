"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import {
  fileToAttachment, hasDraggedFiles, MAX_CHAT_ATTACHMENTS, MAX_CHAT_NON_IMAGE_ATTACHMENTS,
  type ComposerAttachment,
} from "@/lib/chat-attachments";

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
 * - optional cap/added callbacks; persistent read/limit feedback is shared;
 * - focus-after-add via `focus` (home defers a tick, chat focuses directly);
 * - the file-input markup (accept list, snapshot-then-clear re-pick fix).
 */
export function useAttachmentStaging(opts?: {
  maxFiles?: number;
  /** Called when the cap prevents some or all selected files from staging. */
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
  notice: string | null;
  dismissNotice: () => void;
  isReading: boolean;
  dropHandlers: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
} {
  const maxFiles = opts?.maxFiles ?? MAX_CHAT_ATTACHMENTS;
  const onLimit = opts?.onLimit;
  const onAdded = opts?.onAdded;
  const focus = opts?.focus;

  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const pendingRef = useRef(0);
  const pendingNonImageRef = useRef(0);
  const generationRef = useRef(0);
  const [isReading, setIsReading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  useEffect(() => () => { generationRef.current += 1; }, []);

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files?.length) return;
      if (pendingRef.current === 0) setNotice(null);
      // Reserve before reading: two drops can arrive before either read settles.
      const room = Math.max(0, maxFiles - attachmentsRef.current.length - pendingRef.current);
      let nonImageRoom = Math.max(0, MAX_CHAT_NON_IMAGE_ATTACHMENTS
        - attachmentsRef.current.filter((attachment) => !(attachment.mimeType ?? attachment.type)?.startsWith("image/")).length
        - pendingNonImageRef.current);
      const selected: File[] = [];
      for (const file of Array.from(files)) {
        if (selected.length >= room) break;
        if (!file.type.startsWith("image/")) {
          if (nonImageRoom === 0) continue;
          nonImageRoom -= 1;
        }
        selected.push(file);
      }
      if (selected.length < files.length) {
        setNotice(`You can attach up to ${maxFiles} images or ${MAX_CHAT_NON_IMAGE_ATTACHMENTS} other files, ${maxFiles} total. Remove an attachment before adding another.`);
        onLimit?.();
      }
      if (selected.length === 0) return;
      const generation = generationRef.current;
      pendingRef.current += selected.length;
      const selectedNonImages = selected.filter((file) => !file.type.startsWith("image/")).length;
      pendingNonImageRef.current += selectedNonImages;
      setIsReading(true);
      const results = await Promise.allSettled(selected.map(fileToAttachment));
      if (generation !== generationRef.current) return;
      const next: ComposerAttachment[] = [];
      const problems: string[] = [];
      results.forEach((result, index) => {
        const name = selected[index].name;
        if (result.status === "rejected") {
          problems.push(`${name} couldn't be read. Choose it again.`);
          return;
        }
        const attachment = result.value;
        if (!attachment.dataUrl && attachment.text === undefined) {
          problems.push(attachment.truncated
            ? `${name} is too large. Choose a smaller file.`
            : `${name} couldn't be read. Choose it again.`);
          return;
        }
        next.push(attachment);
        if (attachment.truncated) problems.push(`Text from ${name} was shortened to fit the attachment limit.`);
      });
      pendingRef.current -= selected.length;
      pendingNonImageRef.current -= selectedNonImages;
      setIsReading(pendingRef.current > 0);
      if (problems.length) setNotice(previous => [previous, ...problems].filter(Boolean).join(" "));
      if (next.length) {
        attachmentsRef.current = [...attachmentsRef.current, ...next];
        setAttachments(attachmentsRef.current);
        onAdded?.(next.length);
      }
      focus?.();
    },
    [maxFiles, onLimit, onAdded, focus],
  );

  const removeAttachment = useCallback((id: string) => {
    attachmentsRef.current = attachmentsRef.current.filter(a => a.id !== id);
    setAttachments(attachmentsRef.current);
  }, []);

  const clearAttachments = useCallback(() => {
    generationRef.current += 1;
    pendingRef.current = 0;
    pendingNonImageRef.current = 0;
    attachmentsRef.current = [];
    setAttachments([]);
    setIsReading(false);
    setNotice(null);
  }, []);

  // Paste-to-attach: clipboard files (screenshots, copied files) win over any
  // text payload riding along. Only preventDefault when files were actually
  // consumed so a plain-text paste is untouched. Check the advertised type
  // first: Windows WebView can make touching clipboard file items on a
  // text-only paste synchronous, while a real file paste advertises `Files`.
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (!hasDraggedFiles(e.clipboardData.types)) return;
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

  return { attachments, addFiles, removeAttachment, clearAttachments, handlePaste, dropActive, dropHandlers, notice, dismissNotice, isReading };
}

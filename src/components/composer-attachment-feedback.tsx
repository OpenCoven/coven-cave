"use client";

import "@/styles/composer-attachment-feedback.css";
import { useEffect } from "react";
import { useAnnouncer } from "@/components/ui/live-region";

/** Shared recovery copy stays beside the draft, including in narrow drawers. */
export function ComposerAttachmentFeedback({ notice, reading, onDismiss }: {
  notice: string | null;
  reading: boolean;
  onDismiss: () => void;
}) {
  const { announce } = useAnnouncer();
  useEffect(() => { if (notice) announce(notice, "assertive"); }, [announce, notice]);
  if (!notice && !reading) return null;
  return (
    <div className="composer-attachment-feedback">
      {reading ? <p role="status">Reading attachments…</p> : null}
      {notice ? <div className="composer-attachment-feedback__notice">
        <p className="composer-attachment-feedback__message focus-ring" role="region" aria-label="Attachment notice" tabIndex={0}>{notice}</p>
        <button type="button" className="focus-ring" onClick={onDismiss} aria-label="Dismiss attachment notice">Dismiss</button>
      </div> : null}
    </div>
  );
}

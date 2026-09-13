"use client";

import { useId } from "react";
import { Modal } from "@/components/ui/modal";
import type { ChatContinuityChapter, ChatContinuityIndex } from "@/lib/chat-continuity-chapters";
import "@/styles/chat-chapter-navigator.css";

export type ChatChapterNavigatorProps = {
  index: ChatContinuityIndex;
  open: boolean;
  selectedId: string | null;
  locationUnavailable?: boolean;
  window?: {
    start: number;
    end: number;
    total: number;
    atLatest: boolean;
    onEarlier: () => void;
    onLater: () => void;
    onLatest: () => void;
  };
  onOpenChange: (open: boolean) => void;
  onSelect: (chapter: ChatContinuityChapter) => void;
};

export function ChatChapterNavigator({ index, open, selectedId, locationUnavailable = false, window, onOpenChange, onSelect }: ChatChapterNavigatorProps) {
  const descriptionId = useId();
  const available = index.status !== "unavailable";
  return (
    <div className="chat-chapter-navigator">
      <span className="chat-chapter-navigator__scope">This chat · UTC chapters</span>
      <button
        type="button"
        className="chat-chapter-navigator__trigger focus-ring"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
      >
        {available ? "Browse chapters" : "Chapter index unavailable"}
      </button>
      {window ? (
        <nav className="chat-chapter-navigator__window" aria-label="Loaded transcript window">
          <span>Turns {window.end > window.start ? window.start + 1 : 0}–{window.end} of {window.total} loaded</span>
          <button type="button" className="chat-chapter-navigator__trigger focus-ring" disabled={window.start === 0} onClick={window.onEarlier}>Earlier turns</button>
          <button type="button" className="chat-chapter-navigator__trigger focus-ring" disabled={window.end >= window.total} onClick={window.onLater}>Later turns</button>
          <button type="button" className="chat-chapter-navigator__trigger focus-ring" disabled={window.atLatest || window.total === 0} onClick={window.onLatest}>Return to latest</button>
        </nav>
      ) : null}
      {locationUnavailable ? (
        <p className="chat-chapter-navigator__notice" role="status" aria-atomic="true">
          Saved location unavailable in the current history. You&apos;re still in the same chat.
        </p>
      ) : null}
      <Modal open={open} onClose={() => onOpenChange(false)} breadcrumb={["This chat", "Chapters"]} ariaDescribedBy={descriptionId}>
        <div className="chat-chapter-index">
          <p id={descriptionId} className="chat-chapter-index__description">
            {index.status === "partial"
              ? "Partial index · Loaded turns on the active branch only. Other chats aren’t included."
              : available
                ? "UTC date chapters on this chat’s active branch. Other chats aren’t included."
                : "Chapter index unavailable. Keep reading the transcript; no messages have been changed."}
          </p>
          {available ? (
            <nav aria-label="UTC date chapters">
              <ol className="chat-chapter-index__list">
                {index.chapters.map((chapter) => (
                  <li key={chapter.id}>
                    <button
                      type="button"
                      className="chat-chapter-index__row focus-ring-inset"
                      data-chapter-id={chapter.id}
                      aria-current={selectedId === chapter.id ? "location" : undefined}
                      onClick={() => {
                        onSelect(chapter);
                        onOpenChange(false);
                      }}
                    >
                      <time dateTime={chapter.day}>{chapter.day}</time>
                      <span>{chapter.turnCount} {chapter.turnCount === 1 ? "turn" : "turns"} · UTC</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          ) : <p role="status">Continue in this chat or choose another chat from Sessions.</p>}
        </div>
      </Modal>
    </div>
  );
}

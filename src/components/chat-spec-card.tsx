"use client";

import "@/styles/chat-spec-card.css";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import type { SpecBlock } from "@/lib/spec-blocks";
import { ChatMarkdownReader } from "@/components/chat-markdown-reader";

export function ChatSpecCard({
  spec,
  onOpenUrl,
}: {
  spec: SpecBlock;
  onOpenUrl?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const labels =
    spec.kind === "handoff"
      ? {
          eyebrow: "Familiar handoff",
          noun: "handoff",
          subject: "Handoff",
          fallbackFilename: "familiar-handoff",
        }
      : {
          eyebrow: "Familiar spec",
          noun: "spec",
          subject: "Spec",
          fallbackFilename: "familiar-spec",
        };

  const meta = [
    spec.sectionCount > 0
      ? `${spec.sectionCount} section${spec.sectionCount === 1 ? "" : "s"}`
      : null,
    `${spec.readingMinutes} min read`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <button
        type="button"
        className="chat-spec-card focus-ring"
        onClick={() => setOpen(true)}
      >
        <span className="chat-spec-card__icon" aria-hidden>
          <Icon name="ph:file-text-bold" width={20} />
        </span>
        <span className="chat-spec-card__content">
          <span className="chat-spec-card__eyebrow">{labels.eyebrow}</span>
          <strong>{spec.title}</strong>
          <span className="chat-spec-card__meta">{meta}</span>
        </span>
        <span className="chat-spec-card__action">
          Open {labels.noun}
          <Icon name="ph:arrow-square-out" width={14} aria-hidden />
        </span>
      </button>
      {open ? (
        <ChatMarkdownReader
          title={spec.title}
          eyebrow={labels.eyebrow}
          noun={labels.noun}
          subject={labels.subject}
          markdown={spec.markdown}
          fallbackFilename={labels.fallbackFilename}
          onClose={() => setOpen(false)}
          onOpenUrl={onOpenUrl}
        />
      ) : null}
    </>
  );
}

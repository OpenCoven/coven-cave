"use client";

import { useEffect, useRef } from "react";
import { AssistantProseRow } from "./AssistantProseRow";
import { CenteredPill } from "./CenteredPill";
import { RunTimeChip } from "./RunTimeChip";
import { RetryRow } from "./RetryRow";
import { TranscriptCard } from "./TranscriptCard";
import { UserRow } from "./UserRow";
import { mockTranscript, type TranscriptEntry } from "./mockTranscript";
import styles from "./styles.module.css";

type Props = {
  entries?: TranscriptEntry[];
};

export function FamiliarChatTranscript({ entries = mockTranscript }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [entries]);

  return (
    <div className={styles.transcriptViewport} ref={viewportRef}>
      <div className={styles.transcript}>
        {entries.map((entry) => {
          switch (entry.kind) {
            case "user":
              return <UserRow key={entry.id} text={entry.text} />;
            case "assistant":
              return <AssistantProseRow key={entry.id} text={entry.text} tone={entry.tone} />;
            case "pill":
              return <CenteredPill key={entry.id} text={entry.text} />;
            case "card":
              return <TranscriptCard key={entry.id} card={entry.card} />;
            case "runtime":
              return <RunTimeChip key={entry.id} label={entry.label} />;
            case "retry":
              return <RetryRow key={entry.id} />;
          }
        })}
      </div>
    </div>
  );
}

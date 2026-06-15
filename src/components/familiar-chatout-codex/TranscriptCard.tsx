"use client";

import { useState } from "react";
import type { TranscriptCardData } from "./mockTranscript";
import styles from "./styles.module.css";

type Props = {
  card: TranscriptCardData;
};

export function TranscriptCard({ card }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isAggregate = card.kind === "aggregate";
  const visibleCount = isAggregate ? card.initiallyVisible ?? 3 : 0;
  const hiddenCount = isAggregate ? Math.max(0, card.files.length - visibleCount) : 0;
  const files = isAggregate && !expanded ? card.files.slice(0, visibleCount) : isAggregate ? card.files : [];
  const title = isAggregate ? card.label : card.path;
  const meta = isAggregate ? null : card.fileType;

  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <span className={styles.fileIcon} aria-hidden>
            {isAggregate ? "⊞" : "▣"}
          </span>
          <div>
            <div className={styles.cardTitle}>{title}</div>
            {meta ? <div className={styles.cardMeta}>{meta}</div> : null}
            <div className={styles.diffSummary} aria-label={`Added ${card.additions}, deleted ${card.deletions}`}>
              <span className={styles.addition}>+{card.additions}</span>
              <span className={styles.deletion}>-{card.deletions}</span>
            </div>
          </div>
        </div>
        <div className={styles.cardActions}>
          <button type="button" className={styles.ghostButton}>Open in⌄</button>
          <button type="button" className={styles.ghostButton}>Undo ↶</button>
          <button type="button" className={styles.ghostButton}>Review</button>
        </div>
      </header>

      {isAggregate ? (
        <div className={styles.fileRows}>
          {files.map((file) => (
            <div className={styles.fileRow} key={file.path}>
              <span className={styles.filePath}>{file.path}</span>
              <span className={styles.addition}>+{file.additions}</span>
              <span className={styles.deletion}>-{file.deletions}</span>
            </div>
          ))}
          {!expanded && hiddenCount > 0 ? (
            <button type="button" className={styles.disclosureButton} onClick={() => setExpanded(true)}>
              Show {hiddenCount} more files⌄
            </button>
          ) : null}
        </div>
      ) : null}

      {card.status ? (
        <footer className={styles.cardFooter}>
          <span className={styles.statusChip}>{card.status}</span>
        </footer>
      ) : null}
    </article>
  );
}

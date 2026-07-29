"use client";

// The daily report's pull-request detail overlay.
//
// This deliberately does NOT reimplement a PR view: it mounts the app's own
// GitHubCard, which already carries the state, checks rollup with its
// expandable run list, review threads with resolve, labels, and the
// comment/approve/merge actions — and which degrades to a plain link when no
// PAT is configured. The report's job is only to frame it.

import { useRef } from "react";

import { GitHubCard } from "@/components/github-card";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import "@/styles/daily-report-pr-modal.css";

export type PrTarget = {
  /** "owner/name" */
  repo: string;
  number: number;
  /** Shown in the header before the card hydrates. */
  title?: string;
  /** Local "HH:MM" the merge landed, when the opener knows it. */
  time?: string;
};

export function DailyReportPrModal({
  target,
  onClose,
}: {
  target: PrTarget | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Escape stays with the report shell, which owns the whole layer stack and
  // closes this before the inline panels — passing no onEscape keeps this
  // trap's listener out of that decision.
  useFocusTrap(Boolean(target), dialogRef);

  if (!target) return null;

  const label = `${repoLabel(target.repo)}#${target.number}`;

  return (
    <div className="drd-pr-scrim" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="drd-pr-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Pull request ${label}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drd-pr-head">
          <Icon name="ph:git-pull-request" aria-hidden />
          <span className="drd-pr-ref">{label}</span>
          {target.title && <span className="drd-pr-title">{target.title}</span>}
          {target.time && <span className="drd-pr-time">merged {target.time}</span>}
          <button type="button" className="drd-pr-close" onClick={onClose} aria-label="Close">
            <Icon name="ph:x" aria-hidden />
          </button>
        </header>

        <div className="drd-pr-body">
          <GitHubCard
            descriptor={{ kind: "pr", repo: target.repo, number: target.number, title: target.title }}
          />
        </div>
      </div>
    </div>
  );
}

function repoLabel(repo: string): string {
  const cut = repo.lastIndexOf("/");
  return cut === -1 ? repo : repo.slice(cut + 1);
}

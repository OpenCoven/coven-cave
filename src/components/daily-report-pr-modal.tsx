"use client";

// The daily report's pull-request detail overlay.
//
// This deliberately does NOT reimplement a PR view: it mounts the app's own
// GitHubCard, which already carries the state, checks rollup with its
// expandable run list, review threads with resolve, labels, and the
// comment/approve/merge actions — and which degrades to a plain link when no
// PAT is configured. The report's job is only to frame it.

import { GitHubCard } from "@/components/github-card";
import { Modal } from "@/components/ui/modal";

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
  if (!target) return null;

  const label = `${repoLabel(target.repo)}#${target.number}`;

  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["Daily report", `Pull request ${label}`]}
      description={target.title}
      size="wide"
      footerPills={target.time ? <span>Merged {target.time}</span> : null}
    >
          <GitHubCard
            descriptor={{ kind: "pr", repo: target.repo, number: target.number, title: target.title }}
          />
    </Modal>
  );
}

function repoLabel(repo: string): string {
  const cut = repo.lastIndexOf("/");
  return cut === -1 ? repo : repo.slice(cut + 1);
}

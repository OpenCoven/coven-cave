"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StandardSelect } from "@/components/ui/select";
import { useAnnouncer } from "@/components/ui/live-region";
import { relativeTime } from "@/lib/relative-time";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { AttentionItem, WorkQueueItem } from "@/lib/beads-work-queue";
import type { PullRequestSummary } from "@/lib/beads-pr-management";

/**
 * Bead inspector (cave-u2p1) — the queue row names the work; this shows the
 * work itself. Reads `bd show --json` through the existing (previously
 * unused) GET /api/beads?mode=show contract. Read-mostly: Claim + copy-id
 * ride along; notes stay on the card's composer.
 */
export function BeadDetailModal({
  id,
  onClose,
  onClaim,
}: {
  id: string;
  onClose: () => void;
  onClaim: () => void;
}) {
  type BeadDetail = {
    id?: string;
    title?: string;
    description?: string | null;
    status?: string;
    priority?: number;
    assignee?: string | null;
    owner?: string | null;
    labels?: string[] | null;
    created_at?: string | null;
    updated_at?: string | null;
    dependencies?: unknown[] | null;
    comment_count?: number | null;
  };
  const [detail, setDetail] = useState<BeadDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setDetailError(null);
    fetch(`/api/beads?mode=show&id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        if (!json.ok) throw new Error(json.error || "bead unavailable");
        // bd show --json returns the bead object (or a one-element array).
        const data = Array.isArray(json.data) ? json.data[0] : json.data;
        setDetail((data ?? {}) as BeadDetail);
      })
      .catch((err) => {
        if (alive) setDetailError(err instanceof Error ? err.message : "bead unavailable");
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <Modal open onClose={onClose} breadcrumb={["Queue", id]} ariaLabel={`Bead ${id}`}>
      <div className="fwq-detail">
        {detailError ? (
          <p className="fwq-detail-error" role="alert">{detailError}</p>
        ) : !detail ? (
          <SkeletonRows count={4} />
        ) : (
          <>
            <h2 className="fwq-detail-title">{detail.title ?? id}</h2>
            <div className="fwq-card-meta">
              {detail.status ? <span className="fwq-tag">{detail.status}</span> : null}
              {detail.priority != null ? (
                <span className={`fwq-tag fwq-tag--p${Math.min(detail.priority, 3)}`}>P{detail.priority}</span>
              ) : null}
              {detail.assignee ? <span className="fwq-tag fwq-tag--familiar">{detail.assignee}</span> : null}
              {(detail.labels ?? []).map((label) => (
                <span key={label} className="fwq-tag">{label}</span>
              ))}
              {detail.updated_at ? (
                <span className="fwq-card-time" title={new Date(detail.updated_at).toLocaleString()}>
                  updated {relativeTime(detail.updated_at)}
                </span>
              ) : null}
            </div>
            {detail.description ? (
              <pre className="fwq-detail-desc">{detail.description}</pre>
            ) : (
              <p className="fwq-detail-empty">No description on this bead.</p>
            )}
            {Array.isArray(detail.dependencies) && detail.dependencies.length > 0 ? (
              <p className="fwq-detail-deps">
                {detail.dependencies.length} dependenc{detail.dependencies.length === 1 ? "y" : "ies"}
                {detail.comment_count ? ` · ${detail.comment_count} comment${detail.comment_count === 1 ? "" : "s"}` : ""}
              </p>
            ) : detail.comment_count ? (
              <p className="fwq-detail-deps">
                {detail.comment_count} comment{detail.comment_count === 1 ? "" : "s"}
              </p>
            ) : null}
            <div className="fwq-detail-actions">
              <Button
                variant="ghost"
                size="xs"
                leadingIcon="ph:copy"
                onClick={() => {
                  void import("@/lib/clipboard").then(async ({ copyText }) => {
                    announce((await copyText(id)) ? `Copied ${id}.` : "Copy failed.", "polite");
                  });
                }}
              >
                Copy id
              </Button>
              {detail.status === "open" || detail.status === "ready" ? (
                <Button variant="secondary" size="xs" leadingIcon="ph:hand" onClick={onClaim}>
                  Claim
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Repo-wide housekeeping callout for the two gaps the CLI patrol flags: open
 * PRs with no linked bead (invisible to the queue) and/or gone stale. Global —
 * NOT filtered by the familiar chips, since an unlinked PR has no familiar and
 * this is repo hygiene, not one familiar's queue.
 */
export function AttentionStrip({
  items,
  onOpenUrl,
  onFileBead,
}: {
  items: AttentionItem[];
  onOpenUrl?: (url: string) => void;
  /** Files a bead for an unlinked PR; resolves once the queue reloaded (or the
   *  attempt failed) so the row's button can drop its busy state. */
  onFileBead?: (pr: PullRequestSummary) => Promise<boolean>;
}) {
  // Per-row busy: only the clicked File-bead button spins while the create +
  // queue reload are in flight.
  const [filingPr, setFilingPr] = useState<number | null>(null);
  const fileBead = async (pr: PullRequestSummary) => {
    if (!onFileBead || filingPr != null) return;
    setFilingPr(pr.number);
    try {
      await onFileBead(pr);
    } finally {
      setFilingPr(null);
    }
  };

  const unlinkedCount = items.filter((i) => i.unlinked).length;
  const staleCount = items.filter((i) => i.stale).length;
  const summary = [
    unlinkedCount ? `${unlinkedCount} unlinked` : null,
    staleCount ? `${staleCount} stale` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="fwq-attention" aria-label="PRs needing attention">
      <header className="fwq-attention-head">
        <Icon name="ph:warning-circle" width={14} aria-hidden />
        <span className="fwq-attention-title">Needs attention</span>
        <span className="fwq-attention-summary">{summary}</span>
      </header>
      <ul className="fwq-attention-list">
        {items.map(({ pr, unlinked, stale }) => (
          <li key={pr.number} className="fwq-attention-item">
            <div className="fwq-attention-main">
              <span className="fwq-pr-num">#{pr.number}</span>
              <span className="fwq-attention-name">{pr.title}</span>
            </div>
            <div className="fwq-attention-tags">
              {unlinked ? (
                <span className="fwq-tag fwq-tag--unlinked" title="No linked bead — invisible to the queue">
                  no bead
                </span>
              ) : null}
              {stale ? <span className="fwq-tag fwq-tag--stale">stale</span> : null}
            </div>
            {unlinked ? (
              <Button
                variant="secondary"
                size="xs"
                leadingIcon="ph:plus-circle"
                loading={filingPr === pr.number}
                onClick={() => void fileBead(pr)}
                disabled={!onFileBead || filingPr != null}
                title="File a bead for this PR so it joins the queue"
              >
                File bead
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="xs"
              trailingIcon="ph:arrow-square-out"
              onClick={() => onOpenUrl?.(pr.url)}
              disabled={!onOpenUrl}
            >
              Open PR
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WorkQueueCard({
  item,
  familiarLabel,
  familiars,
  busy,
  hasEvidence,
  onOpenUrl,
  onClaim,
  onClaimFor,
  onClose,
  onComment,
  onInspect,
}: {
  item: WorkQueueItem;
  familiarLabel: string;
  familiars: ResolvedFamiliar[];
  busy: boolean;
  hasEvidence: boolean;
  onOpenUrl?: (url: string) => void;
  onClaim: () => void;
  onClaimFor: (familiar: ResolvedFamiliar) => void;
  onClose: () => void;
  onComment: (text: string) => Promise<boolean>;
  /** Opens the bead inspector; absent on rows with no bead. */
  onInspect?: () => void;
}) {
  const beadId = item.bead?.id ?? null;
  const title = item.pr?.title ?? item.merged?.title ?? item.bead?.title ?? "Untitled";
  const prNumber = item.pr?.number ?? item.merged?.number ?? null;
  const url = item.pr?.url ?? item.merged?.url ?? null;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const noteButtonRef = useRef<HTMLButtonElement | null>(null);
  const isCleanup = item.lane === "post-merge-cleanup";
  // Close is exposed on the cleanup lane, but only once verification evidence
  // (a handoff note) is on record — the operator adds one via the composer.
  const closeBlocked = isCleanup && !hasEvidence;

  // Keyboard/AT flow for the inline composer: focus lands in the textarea when
  // it opens, and returns to the Note toggle whenever it closes (submit,
  // Cancel, Escape) — otherwise focus drops to <body> on unmount.
  useEffect(() => {
    if (composing) noteInputRef.current?.focus();
  }, [composing]);

  const closeComposer = (opts?: { clearDraft?: boolean }) => {
    if (opts?.clearDraft) setDraft("");
    setComposing(false);
    noteButtonRef.current?.focus();
  };

  const submitNote = async () => {
    if (!draft.trim()) return;
    const ok = await onComment(draft);
    if (ok) closeComposer({ clearDraft: true });
  };

  return (
    <li className={`fwq-card${item.stale ? " is-stale" : ""}`}>
      <div className="fwq-card-main">
        <div className="fwq-card-title">
          {prNumber != null ? <span className="fwq-pr-num">#{prNumber}</span> : null}
          {onInspect ? (
            <button
              type="button"
              className="fwq-card-name fwq-card-name--link focus-ring-inset"
              title={`Inspect ${beadId}`}
              onClick={onInspect}
            >
              {title}
            </button>
          ) : (
            <span className="fwq-card-name">{title}</span>
          )}
        </div>
        <div className="fwq-card-meta">
          <span className="fwq-tag fwq-tag--familiar">{familiarLabel}</span>
          {item.surface ? <span className="fwq-tag">{item.surface}</span> : null}
          {beadId ? <span className="fwq-tag fwq-tag--bead">{beadId}</span> : null}
          {item.bead && !item.pr && !item.merged ? (
            <span className={`fwq-tag fwq-tag--p${Math.min(item.bead.priority, 3)}`}>P{item.bead.priority}</span>
          ) : null}
          {item.pr ? (
            <>
              <span className={`fwq-tag fwq-tag--check-${item.pr.checkStatus ?? "unknown"}`}>
                checks {item.pr.checkStatus ?? "unknown"}
              </span>
              {item.pr.reviewDecision && item.pr.reviewDecision !== "UNKNOWN" ? (
                <span className="fwq-tag">{item.pr.reviewDecision.toLowerCase().replace(/_/g, " ")}</span>
              ) : null}
              {item.lane === "ready-to-merge" ? <span className="fwq-tag fwq-tag--ready">merge eligible</span> : null}
            </>
          ) : null}
          {item.stale ? <span className="fwq-tag fwq-tag--stale">stale</span> : null}
          {item.pr?.updatedAt ? (
            <span className="fwq-card-time" title={new Date(item.pr.updatedAt).toLocaleString()}>
              updated {relativeTime(item.pr.updatedAt)}
            </span>
          ) : null}
          {item.merged?.mergedAt ? (
            <span className="fwq-card-time" title={new Date(item.merged.mergedAt).toLocaleString()}>
              merged {relativeTime(item.merged.mergedAt)}
            </span>
          ) : null}
          {!item.pr && !item.merged && item.bead?.updated_at ? (
            <span className="fwq-card-time" title={new Date(item.bead.updated_at).toLocaleString()}>
              updated {relativeTime(item.bead.updated_at)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="fwq-card-actions">
        {url ? (
          <Button
            variant="ghost"
            size="xs"
            trailingIcon="ph:arrow-square-out"
            onClick={() => onOpenUrl?.(url)}
            disabled={!onOpenUrl}
          >
            {item.merged ? "Merged PR" : "Open PR"}
          </Button>
        ) : null}
        {beadId ? (
          <Button
            ref={noteButtonRef}
            variant="ghost"
            size="xs"
            leadingIcon="ph:note-pencil"
            onClick={() => setComposing((v) => !v)}
            aria-expanded={composing}
            aria-label={`Add a handoff note to ${beadId}`}
          >
            Note
          </Button>
        ) : null}
        {item.lane === "no-open-PR" && beadId ? (
          <>
            <Button
              variant="secondary"
              size="xs"
              loading={busy}
              leadingIcon="ph:hand"
              onClick={onClaim}
              title="Take this work item (bead) — marks it in progress under your name"
            >
              Claim
            </Button>
            {/* Split control: bare Claim assigns the connected user; the picker
                claims on a familiar's behalf instead (cave-p63a). */}
            {familiars.length > 0 ? (
              <StandardSelect
                label="Claim for familiar…"
                title="Claim this bead for a familiar instead of yourself"
                value=""
                placeholder="For…"
                showCaret
                className="fwq-claim-for focus-ring-inset"
                disabled={busy}
                options={familiars.map((f) => ({ value: f.id, label: f.display_name }))}
                onChange={(id) => {
                  const familiar = familiars.find((f) => f.id === id);
                  if (familiar) onClaimFor(familiar);
                }}
              />
            ) : null}
          </>
        ) : null}
        {isCleanup && beadId ? (
          <Button
            variant="secondary"
            size="xs"
            loading={busy}
            leadingIcon="ph:check"
            onClick={onClose}
            disabled={closeBlocked}
            title={
              closeBlocked
                ? "Add a handoff note to record verification before closing"
                : "Mark this work item (bead) complete — it leaves the queue"
            }
          >
            Close bead
          </Button>
        ) : null}
      </div>
      {closeBlocked && !composing ? (
        <p className="fwq-card-hint">Add a handoff note to record verification before closing.</p>
      ) : null}
      {composing && beadId ? (
        <div className="fwq-note">
          <textarea
            ref={noteInputRef}
            className="fwq-note-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Handoff note for ${beadId} — what you verified…`}
            aria-label={`Handoff note for ${beadId}`}
            rows={2}
            disabled={busy}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submitNote();
              }
              // Escape closes but keeps the draft — an accidental Escape must
              // not destroy typed verification text (Cancel is the clear).
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeComposer();
              }
            }}
          />
          <div className="fwq-note-actions">
            <Button variant="ghost" size="xs" onClick={() => closeComposer({ clearDraft: true })} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="xs"
              loading={busy}
              leadingIcon="ph:plus"
              onClick={() => void submitNote()}
              disabled={!draft.trim() || busy}
            >
              Add note
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

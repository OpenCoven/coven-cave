"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
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

/** The row's left accent-rail tone (a finite enum → a `fwq-row--rail-*` class,
 *  so the colour stays in CSS rather than an inline style). Bead-only rows read
 *  by priority (what to pick up first); PR-backed rows read by lane state (what
 *  is blocking the merge). */
function railClass(item: WorkQueueItem): string {
  if (!item.pr && !item.merged && item.bead) {
    if (item.bead.priority === 0) return "danger";
    if (item.bead.priority === 1) return "warning";
    return "neutral";
  }
  switch (item.lane) {
    case "checks-failing":
      return "danger";
    case "changes-requested":
      return "warning";
    case "waiting":
      return "waiting";
    case "ready-to-merge":
    case "post-merge-cleanup":
      return "success";
    default:
      return "neutral";
  }
}

// ── Inline markdown note editor (queue redesign) ──────────────────────────────
// A lightweight Write/Preview composer with a formatting toolbar, ported from
// the design prototype. The heavy CodeMirror MdEditor is overkill for a short
// handoff note; this stays self-contained and matches the mock pixel-for-pixel.

type MdKind = "bold" | "italic" | "code" | "h" | "ul" | "quote" | "link";

/** Wrap/insert markdown around the textarea's current selection, returning the
 *  next value and the caret position to restore. */
function applyMarkdown(value: string, start: number, end: number, kind: MdKind): { next: string; caret: number } {
  const sel = value.slice(start, end);
  const atLineStart = start === 0 || value[start - 1] === "\n";
  const nl = atLineStart ? "" : "\n";
  let ins: string;
  switch (kind) {
    case "bold":
      ins = `**${sel || "bold"}**`;
      break;
    case "italic":
      ins = `*${sel || "italic"}*`;
      break;
    case "code":
      ins = `\`${sel || "code"}\``;
      break;
    case "h":
      ins = `${nl}## ${sel || "Heading"}`;
      break;
    case "ul":
      ins = `${nl}- ${sel || "List item"}`;
      break;
    case "quote":
      ins = `${nl}> ${sel || "Quote"}`;
      break;
    case "link":
      ins = `[${sel || "label"}](https://)`;
      break;
    default:
      ins = sel;
  }
  return { next: value.slice(0, start) + ins + value.slice(end), caret: start + ins.length };
}

/** Minimal, escaping markdown → HTML for the preview pane. Every user string is
 *  HTML-escaped before any tag is emitted, so the innerHTML is inert. */
function renderMarkdown(src: string): string {
  if (!src || !src.trim()) {
    return '<p style="color:var(--text-muted);margin:0;">Nothing to preview yet — switch to Write to add details.</p>';
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(
        /`([^`]+)`/g,
        '<code style="font-family:var(--font-mono),monospace;font-size:12px;background:var(--bg-elevated);padding:1px 5px;border-radius:6px;">$1</code>',
      )
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = src.split(/\r?\n/);
  let html = "";
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      html += list === "ul" ? "</ul>" : "</ol>";
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      closeList();
      continue;
    }
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      closeList();
      const lv = m[1].length;
      const sz = lv === 1 ? 18 : lv === 2 ? 15.5 : 13.5;
      html += `<div style="font-weight:600;font-size:${sz}px;margin:12px 0 5px;color:var(--text-primary);">${inline(m[2])}</div>`;
      continue;
    }
    if ((m = line.match(/^>\s?(.*)/))) {
      closeList();
      html += `<div style="border-left:2px solid var(--accent-presence);padding:3px 0 3px 12px;margin:7px 0;color:var(--text-secondary);">${inline(m[1])}</div>`;
      continue;
    }
    if ((m = line.match(/^[-*]\s+(.*)/))) {
      if (list !== "ul") {
        closeList();
        html += '<ul style="margin:7px 0;padding-left:20px;">';
        list = "ul";
      }
      html += `<li style="margin:3px 0;">${inline(m[1])}</li>`;
      continue;
    }
    if ((m = line.match(/^\d+\.\s+(.*)/))) {
      if (list !== "ol") {
        closeList();
        html += '<ol style="margin:7px 0;padding-left:22px;">';
        list = "ol";
      }
      html += `<li style="margin:3px 0;">${inline(m[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p style="margin:7px 0;line-height:1.6;">${inline(line)}</p>`;
  }
  closeList();
  return html;
}

/** Forward-to-familiar dropdown (queue redesign) — replaces the split
 *  StandardSelect. Claims the bead on a familiar's behalf (cave-p63a). Keeps
 *  the "Claim for familiar…" trigger name and menuitemradio items so the a11y
 *  contract (and the e2e claim-for flow) is unchanged. */
function ForwardMenu({
  familiars,
  disabled,
  onClaimFor,
}: {
  familiars: ResolvedFamiliar[];
  disabled: boolean;
  onClaimFor: (familiar: ResolvedFamiliar) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="fwq-forward" ref={rootRef}>
      {open ? (
        <button
          type="button"
          className="fwq-forward-scrim"
          aria-hidden
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className={`fwq-forward-trigger${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Claim for familiar…"
        title="Forward this bead to a familiar (claims it on their behalf)"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="ph:user" width={13} aria-hidden />
        For…
        <Icon name="ph:caret-down-bold" width={12} className="fwq-forward-caret" aria-hidden />
      </button>
      {open ? (
        <div className="fwq-forward-menu" role="menu" aria-label="Forward to familiar">
          <p className="fwq-forward-menu-head">Forward to familiar</p>
          {familiars.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitemradio"
              aria-checked={false}
              className="fwq-forward-item"
              onClick={() => {
                setOpen(false);
                onClaimFor(f);
              }}
            >
              <span className="fwq-forward-avatar" aria-hidden>
                {f.display_name.charAt(0).toUpperCase()}
              </span>
              <span className="fwq-forward-name">{f.display_name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  const isBeadOnly = !item.pr && !item.merged && !!item.bead;
  const isUnassigned = item.familiar === "unassigned";
  const checkStatus = item.pr?.checkStatus ?? null;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteMode, setNoteMode] = useState<"write" | "preview">("write");
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const noteButtonRef = useRef<HTMLButtonElement | null>(null);
  const isCleanup = item.lane === "post-merge-cleanup";
  // Close is exposed on the cleanup lane, but only once verification evidence
  // (a handoff note) is on record — the operator adds one via the composer.
  const closeBlocked = isCleanup && !hasEvidence;

  // Keyboard/AT flow for the inline composer: focus lands in the textarea when
  // it opens (Write mode), and returns to the Note toggle whenever it closes
  // (submit, Cancel, Escape) — otherwise focus drops to <body> on unmount.
  useEffect(() => {
    if (composing && noteMode === "write") noteInputRef.current?.focus();
  }, [composing, noteMode]);

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

  const runMd = (kind: MdKind) => {
    const el = noteInputRef.current;
    if (!el) return;
    const { next, caret } = applyMarkdown(draft, el.selectionStart, el.selectionEnd, kind);
    setDraft(next);
    requestAnimationFrame(() => {
      const t = noteInputRef.current;
      if (t) {
        t.focus();
        t.setSelectionRange(caret, caret);
      }
    });
  };

  return (
    <li className={`fwq-row fwq-row--rail-${railClass(item)}${item.stale ? " is-stale" : ""}`}>
      <div className="fwq-row-main">
        <div className="fwq-row-title">
          {prNumber != null ? <span className="fwq-pr-num">#{prNumber}</span> : null}
          {onInspect ? (
            <button
              type="button"
              className="fwq-row-name fwq-row-name--link focus-ring-inset"
              title={`Inspect ${beadId}`}
              onClick={onInspect}
            >
              {title}
            </button>
          ) : (
            <span className="fwq-row-name">{title}</span>
          )}
        </div>
        <div className="fwq-row-meta">
          <span className={`fwq-assign${isUnassigned ? "" : " fwq-assign--claimed"}`}>
            <span className={`fwq-sigil${isUnassigned ? "" : " fwq-sigil--filled"}`} aria-hidden />
            {familiarLabel}
          </span>
          {beadId ? <span className="fwq-bead">{beadId}</span> : null}
          {checkStatus ? (
            <span className={`fwq-checks fwq-checks--${checkStatus}`}>
              <span className="fwq-checks-dot" aria-hidden />
              checks {checkStatus}
            </span>
          ) : null}
          {item.pr?.reviewDecision && item.pr.reviewDecision !== "UNKNOWN" ? (
            <span className="fwq-tag">{item.pr.reviewDecision.toLowerCase().replace(/_/g, " ")}</span>
          ) : null}
          {item.lane === "ready-to-merge" ? <span className="fwq-tag fwq-tag--ready">merge eligible</span> : null}
          {item.stale ? <span className="fwq-tag fwq-tag--stale">stale</span> : null}
          <span className="fwq-row-trailing">
            {isBeadOnly && item.bead ? (
              <span className={`fwq-pri-text fwq-pri-text--p${Math.min(item.bead.priority, 3)}`}>
                P{item.bead.priority}
              </span>
            ) : null}
            {isBeadOnly && item.bead?.updated_at ? (
              <>
                <span className="fwq-dot-sep" aria-hidden>·</span>
                <span className="fwq-updated" title={new Date(item.bead.updated_at).toLocaleString()}>
                  updated {relativeTime(item.bead.updated_at)}
                </span>
              </>
            ) : null}
            {item.pr?.updatedAt ? (
              <span className="fwq-updated" title={new Date(item.pr.updatedAt).toLocaleString()}>
                updated {relativeTime(item.pr.updatedAt)}
              </span>
            ) : null}
            {item.merged?.mergedAt ? (
              <span className="fwq-updated" title={new Date(item.merged.mergedAt).toLocaleString()}>
                merged {relativeTime(item.merged.mergedAt)}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <div className="fwq-row-actions">
        {url ? (
          <button
            type="button"
            className="fwq-act"
            onClick={() => onOpenUrl?.(url)}
            disabled={!onOpenUrl}
          >
            {item.merged ? "Merged PR" : "Open PR"}
            <Icon name="ph:arrow-square-out" width={13} aria-hidden />
          </button>
        ) : null}
        {beadId ? (
          <button
            ref={noteButtonRef}
            type="button"
            className={`fwq-act${composing ? " is-active" : ""}`}
            onClick={() => setComposing((v) => !v)}
            aria-expanded={composing}
            aria-label={`Add a handoff note to ${beadId}`}
          >
            <Icon name="ph:note-pencil" width={13} aria-hidden />
            Note
          </button>
        ) : null}
        {item.lane === "no-open-PR" && beadId ? (
          <>
            <button
              type="button"
              className="fwq-act fwq-act--claim"
              onClick={onClaim}
              disabled={busy}
              title="Take this work item (bead) — marks it in progress under your name"
            >
              <Icon name="ph:hand" width={13} aria-hidden />
              Claim
            </button>
            {/* Split control: bare Claim assigns the connected user; the picker
                claims on a familiar's behalf instead (cave-p63a). */}
            {familiars.length > 0 ? (
              <ForwardMenu familiars={familiars} disabled={busy} onClaimFor={onClaimFor} />
            ) : null}
          </>
        ) : null}
        {isCleanup && beadId ? (
          <button
            type="button"
            className="fwq-act fwq-act--claim"
            onClick={onClose}
            disabled={closeBlocked || busy}
            title={
              closeBlocked
                ? "Add a handoff note to record verification before closing"
                : "Mark this work item (bead) complete — it leaves the queue"
            }
          >
            <Icon name="ph:check" width={13} aria-hidden />
            Close bead
          </button>
        ) : null}
      </div>
      {closeBlocked && !composing ? (
        <p className="fwq-row-hint">Add a handoff note to record verification before closing.</p>
      ) : null}
      {composing && beadId ? (
        <div className="fwq-note">
          <div className="fwq-note-head">
            <div className="fwq-note-tabs" role="group" aria-label="Note mode">
              <button
                type="button"
                className={`fwq-note-tab${noteMode === "write" ? " is-active" : ""}`}
                aria-pressed={noteMode === "write"}
                onClick={() => setNoteMode("write")}
              >
                Write
              </button>
              <button
                type="button"
                className={`fwq-note-tab${noteMode === "preview" ? " is-active" : ""}`}
                aria-pressed={noteMode === "preview"}
                onClick={() => setNoteMode("preview")}
              >
                Preview
              </button>
            </div>
            {noteMode === "write" ? (
              <div className="fwq-note-tools" role="group" aria-label="Formatting">
                <button type="button" className="fwq-note-tool fwq-note-tool--b" title="Bold" onClick={() => runMd("bold")}>
                  B
                </button>
                <button type="button" className="fwq-note-tool fwq-note-tool--i" title="Italic" onClick={() => runMd("italic")}>
                  i
                </button>
                <button type="button" className="fwq-note-tool" title="Code" onClick={() => runMd("code")}>
                  <Icon name="ph:code" width={14} aria-hidden />
                </button>
                <button type="button" className="fwq-note-tool fwq-note-tool--h" title="Heading" onClick={() => runMd("h")}>
                  H
                </button>
                <button type="button" className="fwq-note-tool" title="List" onClick={() => runMd("ul")}>
                  <Icon name="ph:list-bullets" width={14} aria-hidden />
                </button>
                <button type="button" className="fwq-note-tool" title="Quote" onClick={() => runMd("quote")}>
                  <Icon name="ph:chat-teardrop" width={14} aria-hidden />
                </button>
                <button type="button" className="fwq-note-tool" title="Link" onClick={() => runMd("link")}>
                  <Icon name="ph:link" width={14} aria-hidden />
                </button>
              </div>
            ) : null}
            <span className="fwq-note-lang">markdown</span>
          </div>
          <div className="fwq-note-body">
            {noteMode === "write" ? (
              <textarea
                ref={noteInputRef}
                className="fwq-note-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Handoff note for ${beadId} — **bold**, *italic*, \`code\`, - lists, > quote, [links](url)…`}
                aria-label={`Handoff note for ${beadId}`}
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
            ) : (
              <div
                className="fwq-note-preview"
                // Inert: renderMarkdown HTML-escapes every user string before
                // emitting any tag (see the esc() pass), so this cannot inject.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
              />
            )}
          </div>
          <div className="fwq-note-foot">
            <button
              type="button"
              className="fwq-note-cancel"
              onClick={() => closeComposer({ clearDraft: true })}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="fwq-note-save"
              onClick={() => void submitNote()}
              disabled={!draft.trim() || busy}
            >
              Save note
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

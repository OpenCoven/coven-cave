"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import type { Card } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
import {
  attachGitHubItemToCard,
  createBoardCardFromGitHubItem,
  itemToContext,
} from "@/lib/github-tasks";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";

// ── Types ──────────────────────────────────────────────────────────────────────

export type PopoverMode = "board" | "chat" | "assign";

type Props = {
  mode: PopoverMode;
  item: GitHubItem;
  familiars: Familiar[];
  cards: Card[];
  /** The corresponding load FAILED — an empty list then means "couldn't
   *  load", not "none exist" (cave-59cv). */
  familiarsFailed?: boolean;
  cardsFailed?: boolean;
  onClose: () => void;
};

// ── Feedback banner ────────────────────────────────────────────────────────────

function FeedbackBanner({
  status,
  message,
}: {
  status: "success" | "error";
  message: string;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] ${
        status === "success"
          ? "bg-[color-mix(in_oklch,var(--color-success)_60%,transparent)] text-[var(--color-success)]"
          : "bg-[color-mix(in_oklch,var(--color-danger)_60%,transparent)] text-[var(--color-danger)]"
      }`}
    >
      <Icon
        name={status === "success" ? "ph:check-circle" : "ph:warning-circle"}
        width={13}
      />
      {message}
    </div>
  );
}

// ── Board mode ─────────────────────────────────────────────────────────────────

function BoardMode({
  item,
  cards,
  cardsFailed = false,
  onClose,
}: {
  item: GitHubItem;
  cards: Card[];
  cardsFailed?: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const openCards = cards.filter(
    (c) => c.status !== "done" && c.status !== "blocked",
  );
  const filtered = query.trim()
    ? openCards.filter((c) =>
        c.title.toLowerCase().includes(query.toLowerCase()),
      )
    : openCards;

  async function attachToCard(cardId: string) {
    setBusy(true);
    setFeedback(null);
    const result = await attachGitHubItemToCard(cardId, item);
    setBusy(false);
    if (result.ok) {
      setFeedback({ status: "success", message: "Link added to card." });
      setTimeout(onClose, 1200);
    } else {
      setFeedback({ status: "error", message: result.error ?? "Failed." });
    }
  }

  async function createNew() {
    setBusy(true);
    setFeedback(null);
    const result = await createBoardCardFromGitHubItem(item, null);
    setBusy(false);
    if (result.ok) {
      setFeedback({ status: "success", message: "Card created." });
      setTimeout(onClose, 1200);
    } else {
      setFeedback({ status: "error", message: result.error ?? "Failed." });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-[var(--text-muted)]">
        Add to existing card or create new
      </p>

      {feedback && (
        <FeedbackBanner status={feedback.status} message={feedback.message} />
      )}

      {/* Create new */}
      <button
        type="button"
        onClick={() => void createNew()}
        disabled={busy}
        className="flex items-center gap-2 rounded-md border border-dashed border-[var(--border-hairline)] px-2.5 py-1.5 text-[12px] text-[var(--accent-presence)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
      >
        <Icon name="ph:plus" width={12} />
        Create new card
      </button>

      {/* Search existing */}
      {openCards.length > 0 && (
        <>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search open cards…"
            aria-label="Search open cards"
            className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] focus:outline-none"
          />
          <ul className="max-h-40 overflow-y-auto space-y-0.5">
            {filtered.slice(0, 12).map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => void attachToCard(card.id)}
                  disabled={busy}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                >
                  {card.title}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]">
                {cardsFailed && cards.length === 0
                  ? "Couldn't load your tasks — close and reopen to retry."
                  : "No cards match."}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Familiar picker (shared by chat + assign modes) ────────────────────────────

function FamiliarPicker({
  familiars,
  familiarsFailed = false,
  item,
  mode,
  onClose,
}: {
  familiars: Familiar[];
  familiarsFailed?: boolean;
  item: GitHubItem;
  mode: "chat" | "assign";
  onClose: () => void;
}) {
  const resolved = useResolvedFamiliars(familiars);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function handleSubmit() {
    if (!selected) return;
    setBusy(true);
    setFeedback(null);

    if (mode === "chat") {
      const ctx = itemToContext(item);
      const kindLabel =
        ctx.kind === "review_request"
          ? "Review Request"
          : ctx.kind === "pr"
            ? "Pull Request"
            : ctx.kind === "notification"
              ? "Notification"
              : "Issue";
      const contextText = [
        `**${kindLabel}: ${ctx.title}**`,
        `Repo: \`${ctx.repo}\`${ctx.number != null ? ` #${ctx.number}` : ""}`,
        `URL: ${ctx.url}`,
      ].join("\n");

      window.dispatchEvent(
        new CustomEvent("cave:agents-new-chat", {
          detail: { familiarId: selected, context: contextText },
        }),
      );
      setBusy(false);
      setFeedback({ status: "success", message: "Chat opened." });
      setTimeout(onClose, 800);
      return;
    }

    // assign — create a board card assigned to familiar
    const result = await createBoardCardFromGitHubItem(item, selected);
    setBusy(false);
    if (result.ok) {
      setFeedback({ status: "success", message: "Task dispatched." });
      setTimeout(onClose, 1200);
    } else {
      setFeedback({
        status: "error",
        message: result.error ?? "Failed to create task.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-[var(--text-muted)]">
        {mode === "chat" ? "Start a chat with…" : "Assign to…"}
      </p>

      {feedback && (
        <FeedbackBanner status={feedback.status} message={feedback.message} />
      )}

      <ul className="max-h-44 overflow-y-auto space-y-0.5">
        {resolved.map((f) => {
          const isSelected = selected === f.id;
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setSelected(f.id)}
                className={[
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  isSelected
                    ? "bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                <span className="shrink-0 w-4 text-center text-[14px] leading-none">
                  <FamiliarAvatar familiar={f} size="sm" />
                </span>
                <span className="truncate">{f.display_name}</span>
                {isSelected && (
                  <Icon
                    name="ph:check"
                    width={11}
                    className="ml-auto shrink-0 text-[var(--accent-presence)]"
                  />
                )}
              </button>
            </li>
          );
        })}
        {resolved.length === 0 && (
          <li className="px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]">
            {familiarsFailed
              ? "Couldn't load familiars — close and reopen to retry."
              : "No familiars available."}
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!selected || busy}
        className="mt-1 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-presence-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy
          ? "Working…"
          : mode === "chat"
            ? "Open chat"
            : "Dispatch as task"}
      </button>
    </div>
  );
}

// ── Main popover ───────────────────────────────────────────────────────────────

export function GitHubActionPopover({
  mode,
  item,
  familiars,
  cards,
  familiarsFailed = false,
  cardsFailed = false,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Slightly delayed so the opening click doesn't immediately close the popover
    const id = window.setTimeout(
      () => document.addEventListener("mousedown", handleClick),
      50,
    );
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Trap focus inside the popover, close on Escape, and return focus to the
  // trigger on close (the shared dialog convention). Replaces a bare keydown
  // listener that left Tab escaping into the page and lost the return point.
  useFocusTrap(true, ref, { onEscape: onClose });

  const TITLES: Record<PopoverMode, string> = {
    board: "Add to board",
    chat: "Start chat",
    assign: "Assign to familiar",
  };

  const ICONS: Record<PopoverMode, string> = {
    board: "ph:kanban",
    chat: "ph:chat-circle-dots",
    assign: "ph:robot",
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={TITLES[mode]}
      tabIndex={-1}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-3 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon
            name={ICONS[mode] as Parameters<typeof Icon>[0]["name"]}
            width={13}
            className="text-[var(--accent-presence)]"
          />
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">
            {TITLES[mode]}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Icon name="ph:x" width={12} aria-hidden />
        </button>
      </div>

      {/* Item title preview */}
      <div className="mb-2.5 rounded-md bg-[var(--bg-raised)] px-2.5 py-1.5">
        <p className="truncate text-[11px] text-[var(--text-muted)]">
          {item.repo}
          {item.number != null ? ` #${item.number}` : ""}
        </p>
        <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
          {item.title}
        </p>
      </div>

      {/* Mode content */}
      {mode === "board" && (
        <BoardMode item={item} cards={cards} cardsFailed={cardsFailed} onClose={onClose} />
      )}
      {(mode === "chat" || mode === "assign") && (
        <FamiliarPicker
          familiars={familiars}
          familiarsFailed={familiarsFailed}
          item={item}
          mode={mode}
          onClose={onClose}
        />
      )}
    </div>
  );
}

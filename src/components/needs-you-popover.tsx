"use client";

/**
 * The Needs-you inbox — design handoff `Coven Cave Prototype.dc.html` frame 2c,
 * spec §4.4 and §7. It replaces the running-activity popover (cave-21rp).
 *
 * The change is an inversion, not a reskin. The old control answered "what is
 * running?" with a number that was never zero, so its badge stopped carrying
 * information and a 156-row list stopped being a popover. This one answers
 * "what is stopped on me?" — a list that is usually short and always
 * actionable, with the running count demoted to muted text in the footer.
 *
 * Three rules from the spec are load-bearing here:
 *   - The panel is 100% opaque `--bg-elevated`, NOT glass. The handoff's third
 *     P0 finding is transcript text reading through this exact popover.
 *   - Row tint is spent on awaiting/blocked only; failed carries a badge. A
 *     row-wide red field across every failure is the alarm wall being retired.
 *   - The badge counts actionable items only, and is absent at zero.
 *
 * All derivation is in `lib/needs-you-inbox.ts`; this file only draws it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover } from "@/components/ui/popover";
import { RelativeTime } from "@/components/ui/relative-time";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon, type IconName } from "@/lib/icon";
import { fetchRunningActivity } from "@/lib/running-activity";
import {
  needsYouElsewhere,
  needsYouItems,
  needsYouWaitFraction,
  unseenNeedsYouItems,
  type NeedsYouItem,
  type NeedsYouLifecycle,
} from "@/lib/needs-you-inbox";
import { markNeedsYouSeen, readNeedsYouSeen } from "@/lib/needs-you-seen";
import { SESSION_LIFECYCLE } from "@/lib/session-lifecycle";
import { useMinuteTick } from "@/lib/use-minute-tick";
import type { Familiar, SessionRow } from "@/lib/types";
import "@/styles/needs-you-inbox.css";

/** One glyph per state. Colour is never the only channel (design language §8),
 *  so the icon and the word both carry the distinction. */
const STATE_ICON: Record<NeedsYouLifecycle, IconName> = {
  blocked: "ph:warning",
  failed: "ph:x-circle",
  awaiting: "ph:hourglass",
};

/** What kind of work this is, drawn from the session's own git context rather
 *  than invented: a reported PR, a branch, or plain conversation. */
function kindIcon(item: NeedsYouItem): IconName {
  if (item.project.includes("/")) return "ph:git-pull-request";
  if (item.branch) return "ph:git-branch";
  return "ph:chat-circle-dots";
}

function badgeText(count: number): string {
  // Capped at 99 per spec §6; the trigger's aria-label carries the exact count.
  return count > 99 ? "99+" : String(count);
}

type RowProps = {
  item: NeedsYouItem;
  familiars: Familiar[];
  now: number;
  onOpen: (item: NeedsYouItem) => void;
};

function NeedsYouRow({ item, familiars, now, onOpen }: RowProps) {
  const presentation = SESSION_LIFECYCLE[item.lifecycle];
  const familiar = item.familiarId
    ? (familiars.find((f) => f.id === item.familiarId)?.display_name ?? null)
    : null;
  const meta = [familiar, item.project, item.branch].filter(Boolean).join(" · ");
  const wait = needsYouWaitFraction(item.since, now);

  return (
    <li>
      <button
        type="button"
        className="needs-you-row focus-ring-inset"
        data-lifecycle={item.lifecycle}
        onClick={() => onOpen(item)}
        // The visible row is title + metadata + state + relative wait. The
        // accessible name says the same things in the same order, so a screen
        // reader gets the scan a sighted reader gets rather than a raw title.
title={item.title}
      >
        <span aria-hidden className="needs-you-row__edge" />
        <span className="needs-you-row__kind" aria-hidden>
          <Icon name={kindIcon(item)} width={14} height={14} />
        </span>
        <span className="needs-you-row__body">
          <span className="needs-you-row__title">{item.title}</span>
          <span className="needs-you-row__meta">{meta}</span>
        </span>
        <span className="needs-you-row__state">
          <span className="needs-you-row__badge">
            <Icon name={STATE_ICON[item.lifecycle]} width={11} height={11} aria-hidden />
            {presentation.label}
          </span>
          <span className="needs-you-row__wait">
            <RelativeTime iso={item.since} now={now} fallback="—" /> waiting
          </span>
        </span>
        {/* A comparative cue across this one list, never a measurement — the
            exact wait is written out above it. Saturates at a week. */}
        <span aria-hidden className="needs-you-row__age">
          <span
            className="needs-you-row__age-fill"
            style={{ inlineSize: `${Math.round(wait * 100)}%` }}
          />
        </span>
      </button>
    </li>
  );
}

type Props = {
  /** Every live session; the inbox derives its own rows (see needs-you-inbox.ts). */
  sessions: SessionRow[];
  /** Familiars, for display-name resolution on rows. */
  familiars: Familiar[];
  /** Open a session's transcript. */
  onOpenSession: (sessionId: string, familiarId: string | null) => void;
  /** Go to the sessions list — the browse surface, per spec §2. */
  onOpenSessions: () => void;
};

export function NeedsYouPopover({
  sessions,
  familiars,
  onOpenSession,
  onOpenSessions,
}: Props) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => readNeedsYouSeen());
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const { announce } = useAnnouncer();
  // Waits are drawn in minutes and days; re-read the clock on the same shared
  // tick the rest of the chrome uses rather than running a timer of our own.
  // The hook returns a counter, not an instant — the instant is derived here.
  const tick = useMinuteTick();
  const now = useMemo(() => Date.now(), [tick]);

  const all = useMemo(() => needsYouItems(sessions), [sessions]);
  const rows = useMemo(() => unseenNeedsYouItems(all, seen), [all, seen]);
  const elsewhere = useMemo(() => needsYouElsewhere(sessions), [sessions]);

  /**
   * The footer's running count, across every source — chats, Board tasks,
   * ritual runs, Flow and Workflow runs.
   *
   * This inbox derives its ROWS from sessions, because attention evidence is
   * server-authored per session and nothing else carries it. But the running
   * total is the one number the retired popover knew that sessions alone do
   * not, so it is read from the same endpoint rather than quietly narrowed to
   * "running chats". Fetched only while the panel is open: it is context in a
   * footer, not a badge, so it does not justify a background poll.
   */
  const [crossSourceRunning, setCrossSourceRunning] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchRunningActivity().then((payload) => {
      // A partial or failed read leaves this null and the footer falls back to
      // the session-derived count, which is true but narrower — better than a
      // total that silently drops a degraded source.
      if (!cancelled && payload) setCrossSourceRunning(payload.total);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const runningCount = crossSourceRunning ?? elsewhere.running;

  const markAllSeen = useCallback(() => {
    const keys = rows.map((item) => item.seenKey);
    if (keys.length === 0) return;
    setSeen(markNeedsYouSeen(seen, keys));
    announce(`Marked ${keys.length} ${keys.length === 1 ? "item" : "items"} seen.`);
  }, [rows, seen, announce, setSeen]);

  const openItem = useCallback(
    (item: NeedsYouItem) => {
      // Opening a session clears it from the count (spec §7) — reading the ask
      // IS the dismissal, so the badge tracks what is genuinely unattended.
      setSeen(markNeedsYouSeen(seen, [item.seenKey]));
      setOpen(false);
      onOpenSession(item.sessionId, item.familiarId);
    },
    [seen, onOpenSession],
  );

  const count = rows.length;

  return (
    <>
      {/* ONE trigger in every state, never a branch.
       *
       * The bell stays mounted at zero — it is how you reach the empty state
       * and the ⇧⌘A binding, and unlike the retired running-activity control
       * there is nothing here to hide: a quiet bell IS the zero reading. What
       * is absent at zero is the BADGE, which is the part that only means
       * something when it is rare.
       *
       * Rendering two different buttons for the two cases would remount this
       * element on open, and `anchorRef` is what the popover positions
       * against — a fresh node on the same tick is a panel placed against a
       * stale rect. */}
      <button
        ref={anchorRef}
        type="button"
        className="menu-bar__status focus-ring needs-you-trigger"
        data-attention={count > 0 ? "true" : undefined}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          count > 0
            ? `Needs you, ${count} ${count === 1 ? "item" : "items"}`
            : `Needs you, nothing waiting. ${runningCount} running.`
        }
        title={count > 0 ? `Needs you, ${count} · ⇧⌘A` : "Needs you · ⇧⌘A"}
      >
        <Icon name="ph:bell" width={22} height={22} aria-hidden />
        {count > 0 ? (
          <span className="menu-bar__badge needs-you-trigger__badge" aria-hidden>
            {badgeText(count)}
          </span>
        ) : null}
      </button>

      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="bottom-end"
        offset={8}
        // The header and footer stay put while the list scrolls under them —
        // the spec's sticky-chrome contract for this panel.
        scrollStrategy="content"
        ariaLabel="Needs you"
        className="needs-you-panel"
      >
        <div className="needs-you-head">
          <span className="needs-you-head__mark" aria-hidden>
            <Icon name="ph:bell" width={13} height={13} />
          </span>
          <strong className="needs-you-head__title">Needs you</strong>
          <span className="needs-you-head__count">{count}</span>
          <span className="needs-you-head__order">oldest first</span>
          <button
            type="button"
            className="needs-you-head__seen focus-ring"
            onClick={markAllSeen}
            disabled={count === 0}
            aria-label={`Mark all ${count} seen`}
            title="Mark all seen"
          >
            <Icon name="ph:check" width={12} height={12} aria-hidden />
          </button>
        </div>

        <div className="needs-you-body">
          {count === 0 ? (
            <EmptyState
              compact
              icon="ph:moon"
              headline="Nothing needs you"
              subtitle={
                runningCount > 0
                  ? `${runningCount} ${runningCount === 1 ? "session" : "sessions"} running quietly.`
                  : "The coven is quiet."
              }
            />
          ) : (
            <ul className="needs-you-list">
              {rows.map((item) => (
                <NeedsYouRow
                  key={item.seenKey}
                  item={item}
                  familiars={familiars}
                  now={now}
                  onOpen={openItem}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="needs-you-foot">
          <span className="needs-you-foot__label">Elsewhere</span>
          {/* Running is text, never a badge (spec §6): a permanent count is a
              badge that has stopped meaning anything. */}
          <span className="needs-you-foot__stat" data-tone="running">
            {runningCount} running
          </span>
          <span className="needs-you-foot__stat">{elsewhere.idle} idle</span>
          <button
            type="button"
            className="needs-you-foot__all focus-ring"
            onClick={() => {
              setOpen(false);
              onOpenSessions();
            }}
          >
            All sessions
            <Icon name="ph:arrow-right" width={12} height={12} aria-hidden />
          </button>
        </div>
      </Popover>
    </>
  );
}

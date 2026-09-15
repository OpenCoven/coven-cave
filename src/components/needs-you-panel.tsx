"use client";

/**
 * The Needs-you panel — everything inside the popover.
 *
 * Split out of `needs-you-popover.tsx` so it can be loaded on demand. The
 * trigger is always-mounted chrome in the desktop menu bar, so anything it
 * imports statically is paid for on first load by every route; the panel only
 * exists once someone opens the bell. Measured: eagerly importing this sheet
 * cost 6.1 KB of first-load CSS, against a budget with 20.2 KB of headroom
 * (`bundle-budget`, which warns THIN below ~15 KB). Splitting it returns most
 * of that.
 *
 * The stylesheet is imported HERE rather than by the trigger, which is what
 * actually moves the bytes — a lazily-imported component's CSS is emitted into
 * its own chunk.
 *
 * Rendering only: every decision about what needs you, in what order, and how
 * long it has waited lives in `lib/needs-you-inbox.ts`.
 */

import { EmptyState } from "@/components/ui/empty-state";
import { Popover } from "@/components/ui/popover";
import { RelativeTime } from "@/components/ui/relative-time";
import { Icon, type IconName } from "@/lib/icon";
import {
  needsYouWaitFraction,
  type NeedsYouItem,
  type NeedsYouLifecycle,
} from "@/lib/needs-you-inbox";
import { SESSION_LIFECYCLE } from "@/lib/session-lifecycle";
import type { Familiar } from "@/lib/types";
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
        aria-label={`${item.title} — ${presentation.label}, ${meta || "no project"}`}
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

type PanelProps = {
  open: boolean;
  setOpen: (next: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  rows: NeedsYouItem[];
  count: number;
  familiars: Familiar[];
  now: number;
  runningCount: number;
  idleCount: number;
  markAllSeen: () => void;
  openItem: (item: NeedsYouItem) => void;
  onOpenSessions: () => void;
};

export default function NeedsYouPanel({
  open,
  setOpen,
  anchorRef,
  rows,
  count,
  familiars,
  now,
  runningCount,
  idleCount,
  markAllSeen,
  openItem,
  onOpenSessions,
}: PanelProps) {
  return (
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
        <span className="needs-you-foot__stat">{idleCount} idle</span>
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
  );
}

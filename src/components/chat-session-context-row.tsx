"use client";

// ── ChatSessionContextRow ─────────────────────────────────────────────────────
// The slim machine-readable band under the session title (Chat.dc.html 2a ③).
//
// Everything human — the title, the lifecycle verbs — stays in the header above
// in Inter/Garamond. This row used to also carry project/branch/model/cwd
// chips (with a project picker), but those duplicated the header's identity
// line one row up, so the band is now stats-only: what the last run cost, on
// the right.

import { useRef, useState } from "react";

import {
  chatContextStats,
  type ChatContextStat,
  type ChatContextTurn,
} from "@/lib/chat-session-context";
import type { TurnUsage } from "@/lib/usage-format";
import { Popover, PopoverBody } from "@/components/ui/popover";

function StatBody({ stat }: { stat: ChatContextStat }) {
  // One tint class on the root; the dot, value and meter fill read it as a
  // custom property, so a new tint never has to be threaded through four
  // child class names.
  return (
    <>
      <span className="cave-chat-context-stat__dot" aria-hidden />
      <span className="cave-chat-context-stat__key">{stat.label}</span>
      <span className="cave-chat-context-stat__value">{stat.value}</span>
      {stat.percent != null ? (
        <span className="cave-chat-context-stat__meter" aria-hidden>
          <span
            className="cave-chat-context-stat__fill"
            style={{ width: `${Math.max(3, Math.min(100, stat.percent))}%` }}
          />
        </span>
      ) : null}
    </>
  );
}

function StatPopover({ stat }: { stat: ChatContextStat }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  if (!stat.detail) {
    return (
      <span className={`cave-chat-context-stat is-${stat.tint}`} title={stat.title}>
        <StatBody stat={stat} />
      </span>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`cave-chat-context-stat cave-chat-context-stat--action focus-ring is-${stat.tint}`}
        title={stat.title}
        aria-label={`${stat.detail.heading} details`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <StatBody stat={stat} />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        placement="bottom-end"
        minWidth={320}
        className="cave-chat-context-popover"
        ariaLabel={`${stat.detail.heading} details`}
      >
        <PopoverBody className="cave-chat-context-breakdown">
          <div className={`cave-chat-context-breakdown__heading is-${stat.tint}`}>
            <span className="cave-chat-context-stat__dot" aria-hidden />
            <span>{stat.detail.heading}</span>
            <span className="cave-chat-context-breakdown__total">{stat.value}</span>
          </div>
          {stat.id === "context" ? (
            <div className="cave-chat-context-breakdown__bar" aria-hidden>
              {stat.detail.rows.map((row) => (
                <span
                  key={row.id}
                  className={`cave-chat-context-breakdown__segment is-${row.tint}`}
                  style={{ width: `${Math.max(0, Math.min(100, row.percent ?? 0))}%` }}
                />
              ))}
            </div>
          ) : null}
          <div className="cave-chat-context-breakdown__rows">
            {stat.detail.rows.map((row) => (
              <div key={row.id} className={`cave-chat-context-breakdown__row is-${row.tint}`}>
                <span className="cave-chat-context-stat__dot" aria-hidden />
                <span className="cave-chat-context-breakdown__label">{row.label}</span>
                <span className="cave-chat-context-breakdown__value">{row.value}</span>
              </div>
            ))}
          </div>
          {stat.detail.note ? (
            <div className="cave-chat-context-breakdown__note">{stat.detail.note}</div>
          ) : null}
        </PopoverBody>
      </Popover>
    </>
  );
}

function StatCell({ stat }: { stat: ChatContextStat }) {
  return (
    <StatPopover stat={stat} />
  );
}

export function ChatSessionContextRow({
  turns,
  usage,
  costUsd,
  durationMs,
  model,
}: {
  turns?: ChatContextTurn[];
  usage?: TurnUsage;
  costUsd?: number;
  durationMs?: number;
  model?: string | null;
}) {
  const stats = chatContextStats({ turns, usage, costUsd, durationMs, model });
  // An empty row is chrome for nothing — a brand-new session with no run yet
  // renders nothing at all.
  if (!stats.length) return null;

  return (
    <div className="cave-chat-context-row" role="group" aria-label="Session context">
      <div className="cave-chat-context-row__stats">
        {stats.map((stat) => (
          <StatCell key={stat.id} stat={stat} />
        ))}
      </div>
    </div>
  );
}

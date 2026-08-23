"use client";

import { useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * TASK ROWS
 *
 *     0ms   rows enter staggered (80ms apart)
 *   600ms   row 1 ring sweeps 0 → 66%
 *  1500ms   row 1 expands — detail steps drop down
 *  3900ms   row 1 collapses; row 2 flips to Failed + retry
 *  5300ms   row 2 resolves to Completed
 * The status run completes once; task details stay clickable.
 * ───────────────────────────────────────────────────────── */

const TICKS = [600, 900, 2400, 1400, 2400, 600];

function useTick(intervals: number[]) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tick >= intervals.length - 1) return;
    const t = setTimeout(() => setTick((x) => x + 1), intervals[tick]);
    return () => clearTimeout(t);
  }, [tick, intervals]);
  return tick;
}

function SpinnerRing({ active, children }: { active?: boolean; children?: React.ReactNode }) {
  const size = 24, stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // size-6 is the 24px `size` const above expressed on the spacing grid — the
  // wrapper box is fixed, so it belongs in a class, not a style object.
  return (
    <span className="relative inline-flex size-6 shrink-0 items-center justify-center">
      <svg
        width={size} height={size} className="absolute inset-0"
        style={active ? { animation: "spin 1.1s linear infinite" } : undefined}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bui-line)" strokeWidth={stroke} />
        {active && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="var(--bui-ink-3)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="relative text-[length:var(--text-xs)] font-semibold tabular-nums text-bui-ink">{children}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: "red" | "green"; children: React.ReactNode }) {
  return (
    <span
      className={[(`flex size-5.5 shrink-0 items-center justify-center rounded-full
        ${tone === "red" ? "bg-bui-red text-bui-red-ink" : "bg-bui-green text-bui-green-ink"}`), "[animation:bui-pop-in_300ms_cubic-bezier(0.23,1,0.32,1)_both]!"].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}

const XIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
);
const CheckIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);
const RetryIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
);

export function TaskRows({ variant = "Capsules" }: { variant?: string }) {
  const tick = useTick(TICKS);
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const row2: "pending" | "failed" | "done" = tick < 3 ? "pending" : tick === 3 ? "failed" : "done";

  const rows = [
    {
      key: "verify",
      badge: <Badge tone="green">{CheckIcon}</Badge>,
      label: "Verified vendor records",
      amount: "12 suppliers",
      pill: (
        <span className="inline-flex h-5.5 items-center rounded-full bg-bui-green-tint px-2 text-[length:var(--text-sm)] font-medium text-bui-green-text">
          Completed
        </span>
      ),
      details: [
        { label: "Matched tax and contact IDs", meta: "12/12" },
        { label: "Flagged stale records", meta: "0" },
      ],
    },
    {
      key: "index",
      badge: <SpinnerRing active>2</SpinnerRing>,
      label: "Build reorder task list",
      amount: "7 SKUs",
      pill: null,
      details: [
        { label: "Reading POS export", meta: "3 files" },
        { label: "Scoring stockout risk", meta: "68%" },
      ],
    },
    {
      key: "draft",
      badge:
        row2 === "pending" ? (
          <SpinnerRing>3</SpinnerRing>
        ) : row2 === "failed" ? (
          <Badge tone="red">{XIcon}</Badge>
        ) : (
          <Badge tone="green">{CheckIcon}</Badge>
        ),
      label: "Draft supplier emails",
      amount: "2 messages",
      pill:
        row2 === "failed" ? (
          <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-bui-red-tint px-2 text-[length:var(--text-sm)] font-medium text-bui-red-text [animation:bui-fade-in_200ms_ease-out_both]!">
            Failed <span className="flex [animation:spin_1.2s_linear_infinite]!">{RetryIcon}</span>
          </span>
        ) : row2 === "done" ? (
          <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-bui-green-tint px-2 text-[length:var(--text-sm)] font-medium text-bui-green-text [animation:bui-fade-in_200ms_ease-out_both]!">
            Completed
          </span>
        ) : null,
      details: [
        { label: "Cone supplier follow-up", meta: "draft" },
        { label: "Pistachio reorder note", meta: "draft" },
      ],
    },
  ];

  const list = variant === "List";
  return (
    <div
      className={`flex w-full max-w-110 flex-col ${
        list ? "gap-0 self-start overflow-hidden rounded-bui-card bg-bui-surface shadow-bui-card" : "min-h-[196px] gap-2"
      }`}
    >
      {rows.map((row, i) => {
        const open = manualOpen[row.key] ?? (row.key === "index" && tick === 2);
        return (
          <div
            key={row.key}
            className={`self-stretch overflow-hidden transition-[border-radius] duration-300 ${
              list ? "border-b border-bui-line last:border-0" : "bg-bui-surface shadow-bui-card"
            }`}
            style={{
              borderRadius: list ? 0 : open ? 14 : 22,
              animation: `bui-fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both`,
            }}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setManualOpen((current) => ({ ...current, [row.key]: !open }))}
              className="flex h-11 w-full items-center gap-2.5 px-2.5 text-left transition-colors duration-100 hover:bg-bui-inset"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                {row.badge}
              </span>
              <span className="min-w-0 flex-1 truncate text-[length:var(--text-base)] font-medium text-bui-ink">
                {row.label}
              </span>
              <span className="text-[length:var(--text-base)] text-bui-ink-2 tabular-nums">{row.amount}</span>
              {row.pill}
              <span
                aria-hidden="true"
                className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-full text-bui-ink-3"
              >
                <svg
                  width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  className="transition-transform duration-300"
                  style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>

            {/* dropdown detail — same expandable grammar as Chain of Thought */}
            <div
              className="grid transition-[grid-template-rows,opacity] duration-300"
                style={{
                  gridTemplateRows: open ? "1fr" : "0fr",
                  opacity: open ? 1 : 0,
                  transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              >
                <div className="overflow-hidden">
                  <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                    <span aria-hidden className="mx-auto h-full w-px bg-bui-line" />
                    <div className="flex flex-col gap-1.5">
                      {row.details.map((d, j) => (
                        <div
                          key={d.label}
                          className="flex items-center justify-between"
                          style={
                            open
                              ? { animation: `bui-fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${120 + j * 100}ms both` }
                              : undefined
                          }
                        >
                          <span className="text-[length:var(--text-sm)] text-bui-ink-2">{d.label}</span>
                          <span className="font-mono text-[length:var(--text-sm)] text-bui-ink-3 tabular-nums">
                            {d.meta}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
          </div>
        );
      })}
    </div>
  );
}

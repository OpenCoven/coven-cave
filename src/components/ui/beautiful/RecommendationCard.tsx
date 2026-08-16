"use client";

import { useState } from "react";

/* ─────────────────────────────────────────────────────────
 * RECOMMENDATION CARD
 * The card holds its shape. Pressing "Alternatives" opens a
 * new drawer listing the other options; picking one promotes
 * it to the recommendation. The primary action confirms.
 * ───────────────────────────────────────────────────────── */

type Option = {
  key: string;
  body: React.ReactNode;
  short: string;
  signal: number;
  tone: string;
  label: string;
  cta: string;
  ctaStyle: string;
};

const OPTIONS: Option[] = [
  {
    key: "high",
    body: (
      <>
        Reorder waffle cones from{" "}
        <code className="rounded-md bg-bui-accent-tint px-1.5 py-0.5 font-mono text-[length:var(--text-sm)] text-bui-accent-ink">cone_king</code>{" "}
        with lead time{" "}
        <code className="rounded-md bg-bui-accent-tint px-1.5 py-0.5 font-mono text-[length:var(--text-sm)] text-bui-accent-ink">7_days</code>.
      </>
    ),
    short: "Reorder from cone_king · 7-day lead",
    signal: 3,
    tone: "var(--bui-green)",
    label: "High confidence",
    cta: "Accept",
    ctaStyle: "bg-bui-accent text-white",
  },
  {
    key: "review",
    body: (
      <>
        Switch vanilla to{" "}
        <code className="rounded-md bg-bui-orange-tint px-1.5 py-0.5 font-mono text-[length:var(--text-sm)] text-bui-orange">vanilla_madagascar</code>{" "}
        for peak season.
      </>
    ),
    short: "Switch to vanilla_madagascar",
    signal: 2,
    tone: "var(--bui-orange)",
    label: "Needs review",
    cta: "Configure",
    ctaStyle: "bg-bui-ink text-bui-canvas",
  },
  {
    key: "none",
    body: (
      <>
        Fall back to a <span className="font-medium text-bui-ink">full restock</span> across every SKU.
      </>
    ),
    short: "Full restock across every SKU",
    signal: 0,
    tone: "var(--bui-ink-3)",
    label: "No signal",
    cta: "Accept full restock",
    ctaStyle: "bg-bui-ink text-bui-canvas",
  },
];

function Meter({ signal, tone }: { signal: number; tone: string }) {
  return (
    <span className="flex items-end gap-0.5">
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="w-1 rounded-full transition-colors duration-300"
          style={{ height: 10, background: bar < signal ? tone : "var(--bui-line-strong)" }}
        />
      ))}
    </span>
  );
}

export function RecommendationCard() {
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const active = OPTIONS[selected];
  const others = OPTIONS.map((o, i) => ({ o, i })).filter(({ i }) => i !== selected);

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-bui-card bg-bui-surface shadow-bui-card">
      <div className="primitive-card-pad">
        <span className="text-[length:var(--text-base)] font-semibold text-bui-ink">
          Want me to place this restock order?
        </span>
        <p
          key={active.key}
          className="mt-1.5 min-h-12 text-[length:var(--text-base)] leading-relaxed text-bui-ink-2 [animation:bui-fade-in_180ms_ease-out_both]!"
        >
          {active.body}
        </p>
      </div>

      {/* alternatives drawer — a distinctly new section of the card */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-bui-line bg-bui-inset px-2 py-2">
            <p className="px-1.5 pb-1 text-[length:var(--text-xs)] font-medium text-bui-ink-3">
              Other options
            </p>
            {others.map(({ o, i }) => (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  setSelected(i);
                  setAccepted(false);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-bui-control px-1.5 py-1.5
                  text-left transition-colors duration-100 hover:bg-bui-hover"
              >
                <Meter signal={o.signal} tone={o.tone} />
                <span className="min-w-0 flex-1 truncate text-[length:var(--text-base)] text-bui-ink">{o.short}</span>
                <span className="shrink-0 text-[length:var(--text-xs)] text-bui-ink-3">{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="primitive-card-footer flex items-center justify-between gap-3 border-t border-bui-line bg-bui-inset">
        <span className="flex items-center gap-2">
          <Meter signal={active.signal} tone={active.tone} />
          <span className="text-[length:var(--text-base)] font-medium text-bui-ink-2">{active.label}</span>
        </span>

        <span className="-mr-0.5 flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className={`h-7 rounded-bui-control px-2.5 text-[length:var(--text-base)] font-medium shadow-bui-btn
              transition-[background-color,transform] duration-100 active:scale-[0.96]
              ${open ? "bg-bui-hover text-bui-ink" : "bg-bui-surface text-bui-ink hover:bg-bui-hover"}`}
          >
            Alternatives
          </button>
          <button
            type="button"
            onClick={() => setAccepted(true)}
            className={`h-7 rounded-bui-control px-3 text-[length:var(--text-base)] font-medium
              shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_0_1px_rgba(16,24,40,0.12),0_1px_2px_rgba(16,24,40,0.1)]
              transition-[background-color,transform] duration-150 active:scale-[0.96]
              ${accepted ? "bg-bui-green text-white" : active.ctaStyle}`}
          >
            {accepted ? "Accepted" : active.cta}
          </button>
        </span>
      </div>
    </div>
  );
}

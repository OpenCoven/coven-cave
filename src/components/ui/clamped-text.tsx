"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Long-form text collapsed to a fixed maximum number of lines with a
 * "View more" toggle. The toggle only appears when the text actually overflows
 * the clamp, so short passages render untouched. Pass the surface's own text
 * class through `className` — the clamp composes with its font/colour/rhythm.
 */
// Static class map — Tailwind only emits classes it can see verbatim.
const LINE_CLAMP: Record<4 | 8, string> = { 4: "line-clamp-4", 8: "line-clamp-8" };

export function ClampedText({
  text,
  className,
  lines = 8,
  moreLabel = "View more",
  lessLabel = "View less",
}: {
  text: string;
  className?: string;
  lines?: 4 | 8;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // A new passage starts collapsed and re-measured: without this, swapping the
  // `text` under one instance (switching missions/iterations) keeps the prior
  // expansion and overflow verdict, so a short summary would render un-clamped
  // behind a lingering "View less". Adjusting state during render (React's
  // derive-state-from-props pattern) avoids ever painting that stale frame.
  const [prevText, setPrevText] = useState(text);
  if (prevText !== text) {
    setPrevText(text);
    setExpanded(false);
    setOverflows(false);
  }

  // Measure only while collapsed: an expanded (un-clamped) paragraph has
  // scrollHeight === clientHeight, so we keep the prior overflow verdict and
  // leave the toggle in place rather than recomputing it away. A ResizeObserver
  // re-checks on reflow (container resize, late-loading fonts); where it's
  // unavailable (house rule — see Sparkline) we still measure once.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <p
        ref={ref}
        className={`${className ?? ""} ${expanded ? "line-clamp-none" : LINE_CLAMP[lines]}`.trim()}
      >
        {text}
      </p>
      {overflows ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="focus-ring text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--accent-presence)] hover:underline"
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      ) : null}
    </div>
  );
}

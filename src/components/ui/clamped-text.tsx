"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Long-form text collapsed to a fixed maximum number of lines with a
 * "View more" toggle. The toggle only appears when the text actually overflows
 * the clamp, so short passages render untouched. Pass the surface's own text
 * class through `className` — the clamp composes with its font/colour/rhythm.
 */
export function ClampedText({
  text,
  className,
  moreLabel = "View more",
  lessLabel = "View less",
}: {
  text: string;
  className?: string;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Measure only while collapsed: an expanded (un-clamped) paragraph has
  // scrollHeight === clientHeight, so we keep the prior overflow verdict and
  // leave the toggle in place rather than recomputing it away. A ResizeObserver
  // re-checks on reflow (container resize, late-loading fonts).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <p
        ref={ref}
        className={`${className ?? ""} ${expanded ? "line-clamp-none" : "line-clamp-8"}`.trim()}
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

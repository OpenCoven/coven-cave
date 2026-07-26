"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { PairingStep } from "@/lib/mobile-handoff";

/** One glyph per checklist state — never color alone (cave-jr4r.1). */
const PAIRING_STEP_GLYPH: Record<PairingStep["state"], { icon: IconName; className: string; announce: string }> = {
  ok: { icon: "ph:check-circle-bold", className: "text-[var(--color-success)]", announce: "done" },
  fail: { icon: "ph:x-circle", className: "text-[var(--color-warning)]", announce: "failed" },
  skipped: { icon: "ph:minus-circle", className: "text-[var(--text-muted)]", announce: "skipped" },
  pending: { icon: "ph:circle-dashed", className: "text-[var(--text-muted)]", announce: "waiting" },
};

/**
 * The proven pairing ladder (access → backend → tailscale → route → phone),
 * rendered as a labelled checklist. Shared between the Settings Phone card and
 * the top-bar "Open on phone" modal so both surfaces tell the same story about
 * which rung broke — or that everything is green and we're just waiting for
 * the first scan.
 */
export function PairingStepsList({
  steps,
  className,
  children,
}: {
  steps: PairingStep[];
  className?: string;
  /** Optional trailing list item(s), e.g. a Retry row after a failed rung. */
  children?: ReactNode;
}) {
  return (
    <ol
      className={`flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-[var(--border-hairline)] px-3.5 py-3 ${className ?? ""}`}
      aria-label="Pairing checklist"
    >
      {steps.map((step) => {
        const glyph = PAIRING_STEP_GLYPH[step.state];
        return (
          <li key={step.id} className="flex items-start gap-2 text-[length:var(--text-sm)]">
            <Icon name={glyph.icon} className={`mt-[1px] shrink-0 ${glyph.className}`} aria-hidden />
            <span className="min-w-0">
              <span className={step.state === "skipped" ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}>
                {step.label}
              </span>
              <span className="sr-only"> — {glyph.announce}</span>
              {step.detail && (step.state === "fail" || step.state === "pending") ? (
                <span className={`block text-[length:var(--text-xs)] leading-relaxed ${step.state === "fail" ? "text-[var(--color-warning)]" : "text-[var(--text-muted)]"}`}>
                  {step.detail}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
      {children}
    </ol>
  );
}

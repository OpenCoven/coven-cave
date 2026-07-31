"use client";

import type { CanonicalMemoryOverview } from "@/lib/canonical-memory";

export function CanonicalMemoryOverviewPanel({
  overview,
}: {
  overview: CanonicalMemoryOverview;
}) {
  const verification = overview.capabilities.verification
    ? overview.verification.state
    : "unavailable";
  return (
    <section
      aria-label="Canonical memory overview"
      className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
          Canonical overview
        </h3>
        {!overview.capabilities.mutations ? (
          <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            Mutations unavailable
          </span>
        ) : null}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[length:var(--text-xs)] @min-[560px]/memview:grid-cols-4">
        <div>
          <dt className="text-[var(--text-muted)]">Entries</dt>
          <dd className="font-semibold text-[var(--text-primary)]">
            {overview.totals.entries}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Familiars</dt>
          <dd className="font-semibold text-[var(--text-primary)]">
            {overview.totals.familiars}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Verification</dt>
          <dd className="font-semibold text-[var(--text-primary)]">
            {verification}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Needs review</dt>
          <dd className="font-semibold text-[var(--text-primary)]">
            {overview.totals.needsReview}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
        Last update{" "}
        {overview.lastUpdatedAt ? (
          <time dateTime={overview.lastUpdatedAt}>{overview.lastUpdatedAt}</time>
        ) : (
          "unavailable"
        )}
      </p>
      <details className="mt-2 border-t border-[var(--border-hairline)] pt-2 text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
        <summary className="focus-ring cursor-pointer rounded-[var(--radius-control)] text-[var(--text-secondary)]">
          Verification details
        </summary>
        <dl className="mt-2 grid gap-1">
          <div>
            <dt className="inline text-[var(--text-muted)]">Manifest: </dt>
            <dd className="inline break-all">
              {overview.verification.manifest ?? "Unavailable"}
            </dd>
          </div>
          <div>
            <dt className="inline text-[var(--text-muted)]">Index: </dt>
            <dd className="inline break-all">
              {overview.verification.index ?? "Unavailable"}
            </dd>
          </div>
          <div>
            <dt className="inline text-[var(--text-muted)]">Issues: </dt>
            <dd className="inline">
              {overview.verification.issues.length > 0
                ? overview.verification.issues.join("; ")
                : "None"}
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

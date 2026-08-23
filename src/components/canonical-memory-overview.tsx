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
      className="fm-overview"
    >
      <div className="fm-overview__head">
        <div>
          <span>Memory health</span>
          <h3>Canonical recall</h3>
        </div>
        {!overview.capabilities.mutations ? (
          <span className="fm-overview__mode">
            Read-only
          </span>
        ) : (
          <span className="fm-overview__mode is-active">Managed</span>
        )}
      </div>
      <dl className="fm-overview__metrics">
        <div>
          <dt>Entries</dt>
          <dd>{overview.totals.entries}</dd>
        </div>
        <div>
          <dt>Familiars</dt>
          <dd>{overview.totals.familiars}</dd>
        </div>
        <div>
          <dt>Verification</dt>
          <dd>{verification}</dd>
        </div>
        <div>
          <dt>Needs review</dt>
          <dd>{overview.totals.needsReview}</dd>
        </div>
      </dl>
      <div className="fm-overview__foot">
        <p>
          Last indexed{" "}
          {overview.lastUpdatedAt ? (
            <time dateTime={overview.lastUpdatedAt}>{overview.lastUpdatedAt}</time>
          ) : (
            "unavailable"
          )}
        </p>
        <details>
          <summary className="focus-ring">
            Verification details
          </summary>
          <dl>
            <div>
              <dt>Manifest</dt>
              <dd>{overview.verification.manifest ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Index</dt>
              <dd>{overview.verification.index ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Issues</dt>
              <dd>
                {overview.verification.issues.length > 0
                  ? overview.verification.issues.join("; ")
                  : "None"}
              </dd>
            </div>
          </dl>
        </details>
      </div>
    </section>
  );
}

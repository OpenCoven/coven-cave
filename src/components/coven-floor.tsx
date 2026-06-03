"use client";

import { useCallback, useEffect, useState } from "react";
import type { FamiliarCard, CovenStatusResponse } from "@/lib/coven-status-types";
import { FamiliarStatusCard } from "@/components/familiar-status-card";

// Coven Floor — live status board showing all familiars.
// Each card shows derived status, current task, and session activity.
// Cards can be expanded to see the session tree.
//
// Refreshes every 15 seconds. Sits inside the "calls" route as the
// first tab alongside the Delegations timeline.

export function CovenFloor() {
  const [familiars, setFamiliars] = useState<FamiliarCard[]>([]);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/coven-status", { cache: "no-store" });
      const json = (await res.json()) as CovenStatusResponse | { ok: false; error: string };
      if (!json.ok) {
        setError((json as { ok: false; error: string }).error ?? "status load failed");
        return;
      }
      const data = json as CovenStatusResponse;
      setFamiliars(data.familiars);
      setComputedAt(data.computedAt);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            The Floor
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            What everyone&apos;s working on right now.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {computedAt && (
            <span className="text-[10px] text-[var(--text-muted)]">
              updated {new Date(computedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Refresh"
          >
            ↺
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-[11px] text-amber-200">
          {error}
        </div>
      )}

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && familiars.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--text-muted)]">
            Loading…
          </div>
        ) : familiars.length === 0 ? (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-[var(--border-hairline)] py-16 text-sm text-[var(--text-secondary)]">
            No familiar activity found.
          </div>
        ) : (
          <div className="space-y-2">
            {familiars.map((card) => (
              <FamiliarStatusCard
                key={card.id}
                card={card}
                expanded={expandedId === card.id}
                onToggle={() => toggleExpand(card.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

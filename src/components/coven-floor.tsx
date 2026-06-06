"use client";

import { useCallback, useEffect, useState } from "react";
import type { FamiliarCard, CovenStatusResponse } from "@/lib/coven-status-types";
import { FamiliarStatusCard } from "@/components/familiar-status-card";

// Coven Floor — live session traceability board.
// Two-column grid; slim toolbar; pulsing "live" indicator.
// Refreshes every 15 seconds.

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
      {/* Error banner */}
      {error && (
        <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-[11px] text-amber-200">
          {error}
        </div>
      )}

      {/* Cards area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Slim toolbar */}
        <div className="mb-3 flex items-center justify-end gap-2">
          {/* Live indicator */}
          <span className="flex items-center gap-1.5">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">live</span>
          </span>

          {/* Computed at */}
          {computedAt && (
            <span className="text-[10px] text-[var(--text-muted)]">
              updated {new Date(computedAt).toLocaleTimeString()}
            </span>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Refresh"
          >
            ↺
          </button>
        </div>

        {/* Content */}
        {loading && familiars.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--text-muted)]">
            Loading…
          </div>
        ) : familiars.length === 0 ? (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-[var(--border-hairline)] py-16 text-sm text-[var(--text-secondary)]">
            No familiar activity found.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

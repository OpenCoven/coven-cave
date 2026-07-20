"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildFamiliarAnalyticsModel,
  loadFamiliarAnalyticsData,
  type FamiliarAnalyticsData,
} from "@/components/familiar-analytics-data";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { FamiliarAnalyticsContent } from "@/components/familiar-analytics-content";

export function FamiliarAnalyticsView({ familiarId }: { familiarId: string }) {
  const [data, setData] = useState<FamiliarAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Truthful freshness stamp — set when a load actually lands, never faked.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  // Loads interleave (mount, familiar switch, manual refresh, 60s poll,
  // on-focus refresh): only the latest issued load may write state, so a slow
  // stale response — possibly for a *previous* familiarId — can't land its
  // data, error, or freshness stamp over a newer one.
  const generation = useRef(0);

  // `silent` marks the recurring background poll: it refreshes the data and
  // freshness stamp but never announces (a 60s AT announcement loop is noise).
  const load = useCallback(async ({ quiet = false, silent = false } = {}) => {
    const gen = ++generation.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const next = await loadFamiliarAnalyticsData(familiarId);
      if (generation.current !== gen) return;
      setData(next);
      setUpdatedAt(new Date().toISOString());
      if (quiet && !silent) announce("Analytics refreshed.");
    } catch (err) {
      if (generation.current !== gen) return;
      setError(err instanceof Error ? err.message : "analytics data unavailable");
    } finally {
      if (generation.current === gen) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [announce, familiarId]);

  useEffect(() => {
    // A new familiar means a fresh page: drop the previous familiar's model
    // (skeleton, not their numbers under the new URL) and stamp. The
    // generation bump inside load() retires any in-flight response.
    setData(null);
    setUpdatedAt(null);
    void load();
  }, [load]);

  // Keep the page live — pulse, sessions, and confidence data drift while
  // familiars work. Pauses in hidden tabs; refreshes on regaining focus.
  usePausablePoll(() => void load({ quiet: true, silent: true }), 60_000);

  const model = useMemo(() => data ? buildFamiliarAnalyticsModel(data) : null, [data]);

  if (loading && !model) {
    return (
      <main className="fa-page" aria-busy="true">
        <div className="fa-section">
          <SkeletonRows count={8} />
        </div>
      </main>
    );
  }

  return (
    <main className="fa-page" aria-busy={loading || refreshing}>
      {error ? (
        <div className="retro-callout" role="alert">
          <Icon name="ph:warning-circle" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}
      {model ? <FamiliarAnalyticsContent model={model} onRefresh={() => void load({ quiet: true })} refreshing={refreshing} updatedAt={updatedAt} /> : (
        <EmptyState
          compact
          icon="ph:users-three-bold"
          headline="No familiar analytics available."
          subtitle="Analytics appear once this familiar has run a session."
        />
      )}
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  flushAppPreferences,
  initializeAppPreferences,
  readAppPreferences,
  subscribeAppPreferences,
} from "@/lib/app-preferences";
import { reapplyIndependentAppearance } from "@/lib/appearance-restore";
import { migrateLegacyBackdropImage } from "@/lib/cave-backdrop";

// Silent bounded auto-retry: a failed or stalled cold-start reconciliation
// (e.g. slow IndexedDB with no online/visibility/subscription event to nudge
// it) self-heals in the background. Backs off, then gives up after three
// attempts — no banner is ever surfaced; the app keeps running on the last
// known-good snapshot and later online/visibility events still re-trigger.
const PREFERENCES_AUTO_RETRY_MS = [5_000, 10_000, 20_000] as const;

function mark(name: string, startTime?: number): void {
  try {
    if (typeof startTime === "number") performance.mark(`cave:${name}`, { startTime });
    else performance.mark(`cave:${name}`);
  } catch {
    // User Timing is optional in tests and older embedded webviews.
  }
}

/** Completes authenticated preference migration and flushes queued writes. */
export function PreferencesBootstrapController() {
  const mounted = useRef(false);
  const autoRetryTimer = useRef<number | null>(null);
  const autoRetryAttempt = useRef(0);

  const bootstrap = useCallback(async () => {
    try {
      const preferences = await initializeAppPreferences();
      if (!mounted.current) return preferences;
      if (preferences.initialized) {
        if (autoRetryTimer.current !== null) {
          window.clearTimeout(autoRetryTimer.current);
          autoRetryTimer.current = null;
        }
        autoRetryAttempt.current = 0;
        mark("reconciliation-settled");
        await migrateLegacyBackdropImage();
      } else {
        scheduleAutoRetry();
      }
      return preferences;
    } catch {
      if (mounted.current) scheduleAutoRetry();
      return readAppPreferences();
    }

    function scheduleAutoRetry(): void {
      if (!mounted.current) return;
      if (autoRetryTimer.current !== null) return; // one pending retry at a time
      const attempt = autoRetryAttempt.current;
      if (attempt >= PREFERENCES_AUTO_RETRY_MS.length) return; // give up silently after 3 retries
      const delay = PREFERENCES_AUTO_RETRY_MS[attempt];
      autoRetryAttempt.current = attempt + 1;
      autoRetryTimer.current = window.setTimeout(() => {
        autoRetryTimer.current = null;
        if (mounted.current) void bootstrap();
      }, delay);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.responseEnd) mark("response-commit", navigation.responseEnd);
    window.requestAnimationFrame(() => mark("shell-visible"));

    const migrateBackdropAfterAuth = async () => {
      const preferences = await bootstrap();
      if (!preferences.initialized) return;
    };
    const retryBackdropMigration = () => {
      void migrateBackdropAfterAuth().catch(() => {
        // Best effort: the migration state deliberately remains retryable
        // after auth, network, server, or IndexedDB failures.
      });
    };
    retryBackdropMigration();
    const unsubscribe = subscribeAppPreferences(() => {
      reapplyIndependentAppearance({
        preserveCustomDefaults: readAppPreferences().appearance.theme.id === "custom",
      });
      if (readAppPreferences().initialized) {
        retryBackdropMigration();
      }
    });

    const flush = () => {
      void flushAppPreferences({ keepalive: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", retryBackdropMigration);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      if (autoRetryTimer.current !== null) {
        window.clearTimeout(autoRetryTimer.current);
        autoRetryTimer.current = null;
      }
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", retryBackdropMigration);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bootstrap]);

  return null;
}

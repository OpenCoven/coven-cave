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
import { useShellBanners } from "@/lib/shell-banners";

const PREFERENCES_BANNER_ID = "preferences-bootstrap";
const PREFERENCES_SLOW_MS = 2_000;

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
  const { pushBanner, dismissBanner } = useShellBanners();
  const mounted = useRef(false);

  const bootstrap = useCallback(async () => {
    const slowTimer = window.setTimeout(() => {
      if (!mounted.current) return;
      pushBanner({
        id: PREFERENCES_BANNER_ID,
        severity: "warning",
        title: "Preferences are still reconciling. Navigation remains available.",
        cta: { label: "Retry now", onClick: () => void bootstrap() },
      });
    }, PREFERENCES_SLOW_MS);

    try {
      const preferences = await initializeAppPreferences();
      if (!mounted.current) return preferences;
      if (preferences.initialized) {
        dismissBanner(PREFERENCES_BANNER_ID);
        mark("reconciliation-settled");
        await migrateLegacyBackdropImage();
      } else {
        pushBanner({
          id: PREFERENCES_BANNER_ID,
          severity: "error",
          title: "Preferences could not be reconciled. Your settings remain unchanged.",
          cta: { label: "Retry", onClick: () => void bootstrap() },
        });
      }
      return preferences;
    } catch {
      if (mounted.current) {
        pushBanner({
          id: PREFERENCES_BANNER_ID,
          severity: "error",
          title: "Preferences could not be reconciled. Your settings remain unchanged.",
          cta: { label: "Retry", onClick: () => void bootstrap() },
        });
      }
      return readAppPreferences();
    } finally {
      window.clearTimeout(slowTimer);
    }
  }, [dismissBanner, pushBanner]);

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
        dismissBanner(PREFERENCES_BANNER_ID);
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
      unsubscribe();
      dismissBanner(PREFERENCES_BANNER_ID);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", retryBackdropMigration);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bootstrap, dismissBanner]);

  return null;
}

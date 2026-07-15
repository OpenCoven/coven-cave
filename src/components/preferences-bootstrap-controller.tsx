"use client";

import { useEffect } from "react";

import {
  flushAppPreferences,
  initializeAppPreferences,
  readAppPreferences,
  subscribeAppPreferences,
} from "@/lib/app-preferences";
import { reapplyIndependentAppearance } from "@/lib/appearance-restore";
import { migrateLegacyBackdropImage } from "@/lib/cave-backdrop";

/** Completes authenticated preference migration and flushes queued writes. */
export function PreferencesBootstrapController() {
  useEffect(() => {
    const migrateBackdropAfterAuth = async () => {
      const preferences = await initializeAppPreferences();
      if (!preferences.initialized) return;
      await migrateLegacyBackdropImage();
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
      if (readAppPreferences().initialized) retryBackdropMigration();
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
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", retryBackdropMigration);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}

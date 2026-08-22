import {
  readAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "./app-preferences.ts";

export const MOBILE_MODE_STORAGE_KEY = "cave:mobile-mode-enabled";

export function readMobileModeEnabled(): boolean {
  return readAppPreferences().phone.mobileMode;
}

/**
 * Subscribe to the canonical preference store instead of maintaining a second
 * component-local copy of Mobile Mode. `useSyncExternalStore` compares the
 * boolean snapshot, so unrelated preference writes do not cause a render.
 */
export function subscribeMobileModeEnabled(listener: () => void): () => void {
  return subscribeAppPreferences(listener);
}

export function writeMobileModeEnabled(enabled: boolean): void {
  updateAppPreferences({ phone: { mobileMode: enabled } });
}

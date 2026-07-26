import { readAppPreferences, updateAppPreferences } from "./app-preferences.ts";

export const MOBILE_MODE_STORAGE_KEY = "cave:mobile-mode-enabled";

export function readMobileModeEnabled(): boolean {
  return readAppPreferences().phone.mobileMode;
}

export function writeMobileModeEnabled(enabled: boolean): void {
  updateAppPreferences({ phone: { mobileMode: enabled } });
}

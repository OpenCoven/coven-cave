import { flushAppPreferences } from "@/lib/app-preferences";

export const SETTINGS_SAVED_EVENT = "cave:settings-saved";

export function showSettingsSavedToast(message = "Saved automatically."): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ message: string }>(SETTINGS_SAVED_EVENT, {
      detail: { message },
    }),
  );
}

export async function showSettingsSavedAfterPreferencesFlush(
  message?: string,
): Promise<boolean> {
  const saved = await flushAppPreferences();
  if (saved) showSettingsSavedToast(message);
  return saved;
}

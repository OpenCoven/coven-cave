/**
 * Thin wrapper around @tauri-apps/plugin-notification.
 * No-ops outside Tauri (e.g. `next dev` in a browser) so the toast path
 * still works without an unhandled dynamic-import error.
 *
 * `sound` semantics — silence is about the *ding*, never about the banner:
 *   undefined  → platform default
 *   null       → silent (send the notification with no sound attached)
 *   string     → named macOS sound (e.g. "Glass", "Funk", "Pop")
 *
 * `null` used to return early and skip `sendNotification` entirely. That made
 * the bell's "Sound → Silent" preference suppress the OS banner as well, which
 * left the in-app toast (`InboxToastStack`, rendered inside the Cave window at
 * z-50) as the only surface — and that toast is behind whatever app is
 * frontmost whenever Cave is not. Users on Silent therefore lost every
 * notification while working in another window. Omitting the `sound` field is
 * what actually produces a soundless banner: the plugin only calls
 * `notification.sound_name(...)` when a sound is supplied, so an absent field
 * means no sound rather than a default one.
 */

export type NotificationPayload = { title: string; body?: string; sound?: string };

/**
 * Build the plugin payload. Pure and exported so the silent-vs-suppressed
 * contract is testable without mocking the Tauri dynamic import.
 */
export function notificationPayload(
  title: string,
  body?: string,
  sound?: string | null,
): NotificationPayload {
  const payload: NotificationPayload = { title, body };
  // Only a named sound sets the field. `undefined` (platform default) and
  // `null` (silent) both omit it — neither one suppresses the notification.
  if (typeof sound === "string") payload.sound = sound;
  return payload;
}

export async function nativeNotify(
  title: string,
  body?: string,
  sound?: string | null,
): Promise<void> {
  if (typeof window === "undefined") return;
  // @ts-expect-error Tauri injects this at runtime
  if (!window.__TAURI_INTERNALS__) return;
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    let granted = await mod.isPermissionGranted();
    if (!granted) granted = (await mod.requestPermission()) === "granted";
    if (!granted) return;
    await mod.sendNotification(notificationPayload(title, body, sound));
  } catch {
    /* native notify failure shouldn't break the app */
  }
}

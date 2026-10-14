"use client";

/**
 * Cross-surface requests to open the "Set up Cave" dialog, and the retained
 * "setup is running in the background" latch (#5982).
 *
 * The dialog is hosted by the Workspace (`cave:onboarding-open` listener) on
 * the root route, but standalone routes such as `/settings` mount no
 * Workspace. `requestOpenSetup()` therefore reports whether any host is
 * registered so a caller can fall back to a local overlay host instead of
 * dispatching an event nobody hears.
 *
 * Mount race: "Run in background" is pressed inside the startup gate before
 * `WorkspaceApp` (and the shell banner strip inside it) exists — the gate
 * mounts the Workspace through `dynamic({ ssr: false })` only after setup
 * is dismissed. A one-shot event fired then would be missed, so the request
 * is a retained latch on `window` (same shape as `summon-events.ts`), read on
 * mount by the banner trigger. `cave:onboarding-backgrounded` covers the
 * already-mounted case.
 */

/** Window event asking a mounted setup host to open the dialog. */
export const SETUP_OPEN_EVENT = "cave:onboarding-open";

/** Window event fired when setup is sent to the background while running. */
export const SETUP_BACKGROUNDED_EVENT = "cave:onboarding-backgrounded";

/** Who asked for the dialog. The Workspace keeps its first-run redirect to
 *  Familiars only for `surface` opens (its own buttons and bare events). */
export type SetupOpenOrigin = "settings" | "banner" | "surface";

const HOST_COUNT_KEY = "__caveSetupHosts";
const BACKGROUNDED_KEY = "__caveSetupBackgrounded";

type SetupWindow = Window & {
  [HOST_COUNT_KEY]?: number;
  [BACKGROUNDED_KEY]?: boolean;
};

function setupWindow(): SetupWindow | null {
  return typeof window === "undefined" ? null : (window as SetupWindow);
}

/** Register the calling component as a dialog host. Returns the unregister. */
export function registerSetupHost(): () => void {
  const target = setupWindow();
  if (!target) return () => undefined;
  target[HOST_COUNT_KEY] = (target[HOST_COUNT_KEY] ?? 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    target[HOST_COUNT_KEY] = Math.max(0, (target[HOST_COUNT_KEY] ?? 1) - 1);
  };
}

export function hasSetupHost(): boolean {
  const target = setupWindow();
  return Boolean(target && (target[HOST_COUNT_KEY] ?? 0) > 0);
}

/** Ask a registered host to open the dialog. False when nobody is listening,
 *  so the caller can mount its own overlay host instead. */
export function requestOpenSetup(origin: SetupOpenOrigin = "surface"): boolean {
  const target = setupWindow();
  if (!target || !hasSetupHost()) return false;
  target.dispatchEvent(new CustomEvent(SETUP_OPEN_EVENT, { detail: { origin } }));
  return true;
}

/** Read the origin carried by a `cave:onboarding-open` event. Bare events
 *  (legacy dispatchers, tests) count as `surface`. */
export function readSetupOpenOrigin(event: Event): SetupOpenOrigin {
  const origin = (event as CustomEvent<{ origin?: unknown }>).detail?.origin;
  return origin === "settings" || origin === "banner" ? origin : "surface";
}

/** Remember that a running setup was sent to the background, and tell any
 *  mounted banner trigger. */
export function markSetupBackgrounded(): void {
  const target = setupWindow();
  if (!target) return;
  target[BACKGROUNDED_KEY] = true;
  target.dispatchEvent(new CustomEvent(SETUP_BACKGROUNDED_EVENT));
}

/** Read and clear the latch (one-shot, like the summon latch). */
export function consumeSetupBackgrounded(): boolean {
  const target = setupWindow();
  if (!target) return false;
  const pending = target[BACKGROUNDED_KEY] === true;
  delete target[BACKGROUNDED_KEY];
  return pending;
}

export function hasSetupBackgrounded(): boolean {
  const target = setupWindow();
  return Boolean(target && target[BACKGROUNDED_KEY] === true);
}

export function clearSetupBackgrounded(): void {
  const target = setupWindow();
  if (!target) return;
  delete target[BACKGROUNDED_KEY];
}

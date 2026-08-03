export const OPEN_IN_APP_BROWSER_EVENT = "cave:open-url-in-browser";
export const PENDING_IN_APP_BROWSER_URL_KEY = "cave:pending-in-app-browser-url";

export function openInAppBrowserUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_IN_APP_BROWSER_URL_KEY, url);
  window.dispatchEvent(new CustomEvent(OPEN_IN_APP_BROWSER_EVENT, { detail: { url } }));
  if (window.location.pathname !== "/") {
    window.location.assign("/#browser");
  }
}

// Historical name kept for existing call sites. External destinations should
// open inside Cave's Browser surface instead of the system browser/new tab.
export function openExternalUrl(url: string): void {
  openInAppBrowserUrl(url);
}

type SystemBrowserPopup = {
  opener: unknown;
  readonly closed?: boolean;
  location: { replace(url: string): void };
  close?: () => void;
};

export type SystemBrowserUrlReservation =
  | { kind: "desktop" }
  | { kind: "browser"; popup: SystemBrowserPopup }
  | { kind: "unavailable" };

type OpenSystemBrowserUrlDependencies = {
  tauri?: boolean;
  invoke?: (command: string, args: { url: string }) => Promise<unknown>;
  openWindow?: () => SystemBrowserPopup | null;
  fallback?: (url: string) => void;
  reservation?: SystemBrowserUrlReservation;
};

function safeHttpUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Reserve a popup synchronously while the browser still has user activation. */
export function reserveSystemBrowserUrlWindow(
  dependencies: Pick<OpenSystemBrowserUrlDependencies, "tauri" | "openWindow"> = {},
): SystemBrowserUrlReservation {
  const tauri = dependencies.tauri
    ?? (typeof window !== "undefined"
      && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined);
  if (tauri) return { kind: "desktop" };

  try {
    const popup = (dependencies.openWindow
      ?? (() => window.open("", "_blank") as SystemBrowserPopup | null))();
    if (!popup) return { kind: "unavailable" };
    // `noopener` window features discard the WindowProxy that this async handoff
    // must navigate, so sever the opener synchronously while retaining the handle.
    popup.opener = null;
    return { kind: "browser", popup };
  } catch {
    return { kind: "unavailable" };
  }
}

export function cancelSystemBrowserUrlWindow(
  reservation: SystemBrowserUrlReservation,
): void {
  if (reservation.kind === "browser") reservation.popup.close?.();
}

/** Open auth-sensitive destinations outside Cave's embedded Browser surface. */
export async function openSystemBrowserUrl(
  rawUrl: string,
  dependencies: OpenSystemBrowserUrlDependencies = {},
): Promise<boolean> {
  const reservation = dependencies.reservation
    ?? reserveSystemBrowserUrlWindow(dependencies);
  const url = safeHttpUrl(rawUrl);
  if (!url) {
    cancelSystemBrowserUrlWindow(reservation);
    return false;
  }

  const fallback = dependencies.fallback ?? openInAppBrowserUrl;

  if (reservation.kind === "desktop") {
    try {
      const invoke = dependencies.invoke ?? (await import("@tauri-apps/api/core")).invoke;
      await invoke("shell_open", { url });
      return true;
    } catch {
      fallback(url);
      return false;
    }
  }

  if (reservation.kind === "unavailable") {
    fallback(url);
    return false;
  }

  try {
    if (reservation.popup.closed) {
      fallback(url);
      return false;
    }
    reservation.popup.location.replace(url);
    return true;
  } catch {
    cancelSystemBrowserUrlWindow(reservation);
    fallback(url);
    return false;
  }
}

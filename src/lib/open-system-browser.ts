import type { TauriPlatform } from "./tauri-platform.ts";

type PopupHandle = {
  opener: unknown;
  readonly closed: boolean;
  location: { replace(url: string): void };
  close(): void;
};

export type SystemBrowserReservation =
  | { ok: true; kind: "desktop" }
  | { ok: true; kind: "browser"; popup: PopupHandle }
  | { ok: false; error: string };

export type ReserveSystemBrowserOptions = {
  platform: TauriPlatform;
  hostname?: string;
  openWindow?: () => PopupHandle | null;
};

type OpenSystemBrowserDependencies = {
  invoke?: (command: string, args: { url: string }) => Promise<unknown>;
};

export type OpenSystemBrowserResult =
  | { ok: true }
  | { ok: false; error: string };

const DESKTOP_REQUIRED =
  "Open Coven Cave on a desktop at localhost to connect X.";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

function defaultOpenWindow(): PopupHandle | null {
  if (typeof window === "undefined") return null;
  return window.open("", "_blank") as PopupHandle | null;
}

function authorizationUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function reserveSystemBrowserWindow(
  options: ReserveSystemBrowserOptions,
): SystemBrowserReservation {
  if (options.platform === "desktop") return { ok: true, kind: "desktop" };
  if (
    options.platform !== "browser"
    || !isLoopbackHostname(options.hostname ?? globalThis.location?.hostname ?? "")
  ) {
    return { ok: false, error: DESKTOP_REQUIRED };
  }

  const popup = (options.openWindow ?? defaultOpenWindow)();
  if (!popup) {
    return {
      ok: false,
      error: "Allow pop-ups for localhost, then try connecting X again.",
    };
  }
  popup.opener = null;
  return { ok: true, kind: "browser", popup };
}

export function cancelSystemBrowserOpen(
  reservation: SystemBrowserReservation,
): void {
  if (reservation.ok && reservation.kind === "browser") {
    reservation.popup.close();
  }
}

export async function openSystemBrowser(
  rawUrl: string,
  reservation: SystemBrowserReservation,
  dependencies: OpenSystemBrowserDependencies = {},
): Promise<OpenSystemBrowserResult> {
  if (!reservation.ok) return reservation;
  const url = authorizationUrl(rawUrl);
  if (!url) {
    cancelSystemBrowserOpen(reservation);
    return { ok: false, error: "X returned an invalid authorization URL." };
  }

  try {
    if (reservation.kind === "browser") {
      if (reservation.popup.closed) {
        return {
          ok: false,
          error: "The authorization window was closed. Try connecting X again.",
        };
      }
      reservation.popup.location.replace(url);
      return { ok: true };
    }

    const invoke = dependencies.invoke ?? (await import("@tauri-apps/api/core")).invoke;
    await invoke("shell_open", { url });
    return { ok: true };
  } catch {
    cancelSystemBrowserOpen(reservation);
    return {
      ok: false,
      error: "Couldn't open X authorization in the system browser.",
    };
  }
}

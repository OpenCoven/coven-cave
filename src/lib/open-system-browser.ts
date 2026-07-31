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
    if (
      url.protocol !== "https:"
      || url.hostname !== "x.com"
      || url.port
      || url.pathname !== "/i/oauth2/authorize"
      || url.username
      || url.password
      || url.hash
    ) {
      return null;
    }
    const entries = [...url.searchParams.entries()];
    const expectedKeys = new Set([
      "response_type",
      "client_id",
      "redirect_uri",
      "scope",
      "state",
      "code_challenge",
      "code_challenge_method",
    ]);
    if (
      entries.length !== expectedKeys.size
      || entries.some(([key]) => !expectedKeys.has(key))
      || new Set(entries.map(([key]) => key)).size !== expectedKeys.size
      || url.searchParams.get("response_type") !== "code"
      || url.searchParams.get("redirect_uri") !== "http://127.0.0.1:1456/x/oauth/callback"
      || url.searchParams.get("code_challenge_method") !== "S256"
      || !/^[A-Za-z0-9._~-]{1,256}$/.test(url.searchParams.get("client_id") ?? "")
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "")
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "")
      || ![
        "tweet.read users.read offline.access",
        "tweet.read users.read offline.access tweet.write",
      ].includes(url.searchParams.get("scope") ?? "")
    ) {
      return null;
    }
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
    await invoke("open_x_oauth_url", { url });
    return { ok: true };
  } catch {
    cancelSystemBrowserOpen(reservation);
    return {
      ok: false,
      error: "Couldn't open X authorization in the system browser.",
    };
  }
}

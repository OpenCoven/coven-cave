"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { isTauri, useIsTauriDesktop } from "@/lib/tauri-platform";
import { useShellBanners } from "@/lib/shell-banners";
import { openInAppBrowserUrl } from "@/lib/open-external";
import { pickDownloadUrl, type UpdateStatus } from "@/lib/app-update";

const BANNER_ID = "update-available";
const RELEASES_PAGE = "https://github.com/OpenCoven/coven-cave/releases/latest";
const DISMISS_KEY = (version: string) => `cave:update:dismissed:${version}`;

function isDismissed(version: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY(version)) === "1";
  } catch {
    return false; // private mode
  }
}

function markDismissed(version: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY(version), "1");
  } catch {
    /* private mode — ignore */
  }
}

// Minimal shape of the plugin-updater Update we depend on.
type TauriUpdate = {
  version: string;
  available?: boolean;
  downloadAndInstall: (onEvent?: (e: DownloadEvent) => void) => Promise<void>;
};
type DownloadEvent =
  | { event: "Started"; data?: { contentLength?: number } }
  | { event: "Progress"; data?: { chunkLength?: number } }
  | { event: "Finished" };

/**
 * Try the native Tauri updater. Returns the Update handle when a newer signed
 * release is available, or null when up to date / unavailable (no endpoint yet,
 * not a desktop build, plugin error). Never throws.
 */
async function checkNativeUpdate(): Promise<TauriUpdate | null> {
  if (!isTauri()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = (await check()) as TauriUpdate | null;
    if (!update) return null;
    // Older plugin versions expose `.available`; newer return null when none.
    if (update.available === false) return null;
    return update;
  } catch {
    return null; // endpoint missing / not signed yet → caller falls back
  }
}

/** Download + install a native update, reporting 0–100 progress, then relaunch. */
async function installNativeUpdate(
  update: TauriUpdate,
  onProgress: (pct: number) => void,
): Promise<void> {
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") {
      total = e.data?.contentLength ?? 0;
    } else if (e.event === "Progress") {
      received += e.data?.chunkLength ?? 0;
      if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)));
    } else if (e.event === "Finished") {
      onProgress(100);
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Lightweight fallback: ask the server route what the latest release is. */
async function fetchFallbackStatus(): Promise<UpdateStatus | null> {
  try {
    const res = await fetch("/api/app/latest-release", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as UpdateStatus;
  } catch {
    return null;
  }
}

/**
 * Resolve a *direct* installer download for the running desktop platform so the
 * fallback "Download" actually downloads (DMG / MSI / AppImage) instead of just
 * opening the release page. Falls back to `status.url` (the release page) when
 * the OS plugin is unavailable or no matching asset shipped.
 */
async function resolveDownloadUrl(status: UpdateStatus): Promise<string> {
  try {
    const { platform, arch } = await import("@tauri-apps/plugin-os");
    return pickDownloadUrl(status, platform(), arch());
  } catch {
    return status.url;
  }
}

/**
 * Open the easiest reachable installer for the running desktop platform in
 * Cave's Browser surface. This is used when the native updater cannot finish,
 * so a broken install attempt still leaves the user one click from the
 * DMG/MSI/AppImage when release metadata is available.
 */
async function openFallbackUpdateInBrowser(): Promise<void> {
  const fb = await fetchFallbackStatus();
  const url = fb ? await resolveDownloadUrl(fb) : RELEASES_PAGE;
  openInAppBrowserUrl(url);
}

type Resolved =
  | { kind: "current" }
  | { kind: "native"; version: string; update: TauriUpdate }
  | { kind: "fallback"; version: string; url: string };

/** Native-first, then fallback. Used by both the banner and the settings row. */
async function resolveUpdate(): Promise<Resolved> {
  const native = await checkNativeUpdate();
  if (native) return { kind: "native", version: native.version, update: native };
  const fb = await fetchFallbackStatus();
  if (fb?.available && fb.latest) {
    const url = await resolveDownloadUrl(fb);
    return { kind: "fallback", version: fb.latest, url };
  }
  return { kind: "current" };
}

/**
 * Desktop-only. On mount, checks for an update and (if available and not
 * dismissed for that version) shows a dismissible shell banner. Renders nothing.
 */
export function UpdateBannerTrigger() {
  const isDesktop = useIsTauriDesktop();
  const { pushBanner, dismissBanner } = useShellBanners();

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void resolveUpdate().then((r) => {
      if (cancelled || r.kind === "current") return;
      if (isDismissed(r.version)) return;

      pushBanner({
        id: BANNER_ID,
        severity: "info",
        title: `Update available — v${r.version}`,
        cta: {
          label: r.kind === "native" ? "Install & restart" : "Open installer in Browser",
          onClick: () => {
            if (r.kind === "native") {
              pushBanner({ id: BANNER_ID, severity: "info", title: `Preparing update v${r.version}…` });
              void installNativeUpdate(r.update, (pct) => {
                pushBanner({
                  id: BANNER_ID,
                  severity: "info",
                  title: `Downloading update v${r.version}… ${pct}%`,
                });
              }).catch((err) => {
                const reason = err instanceof Error ? err.message : "";
                pushBanner({
                  id: BANNER_ID,
                  severity: "warning",
                  title: reason
                    ? `Update failed (${reason})`
                    : "Update failed",
                  cta: { label: "Open installer in Browser", onClick: () => void openFallbackUpdateInBrowser() },
                  onDismiss: () => markDismissed(r.version),
                });
              });
            } else {
              openInAppBrowserUrl(r.url);
            }
          },
        },
        onDismiss: () => markDismissed(r.version),
      });
    });
    return () => {
      cancelled = true;
      dismissBanner(BANNER_ID);
    };
  }, [isDesktop, pushBanner, dismissBanner]);

  return null;
}

type RowState =
  | { phase: "checking" }
  | { phase: "current" }
  | { phase: "available"; r: Extract<Resolved, { kind: "native" | "fallback" }> }
  | { phase: "downloading"; version: string; pct: number }
  | { phase: "failed"; version: string; message: string }
  | { phase: "ready"; version: string };

/**
 * Desktop-only row for Settings ▸ About. Native updater when available
 * (Install & restart with progress), else opens the release installer in Cave's
 * Browser surface.
 */
export function UpdateSettingsRow() {
  const isDesktop = useIsTauriDesktop();
  const [state, setState] = useState<RowState>({ phase: "checking" });
  const mounted = useRef(true);

  const check = useCallback(() => {
    setState({ phase: "checking" });
    void resolveUpdate().then((r) => {
      if (!mounted.current) return;
      if (r.kind === "current") setState({ phase: "current" });
      else setState({ phase: "available", r });
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (isDesktop) check();
    return () => {
      mounted.current = false;
    };
  }, [isDesktop, check]);

  if (!isDesktop) return null;

  const install = (update: TauriUpdate, version: string) => {
    setState({ phase: "downloading", version, pct: 0 });
    void installNativeUpdate(update, (pct) => {
      if (mounted.current) setState({ phase: "downloading", version, pct });
    })
      .then(() => {
        if (mounted.current) setState({ phase: "ready", version });
      })
      .catch((err) => {
        if (mounted.current)
          setState({
            phase: "failed",
            version,
            message: err instanceof Error ? err.message : "Update failed",
          });
      });
  };

  const accentBtn =
    "flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90";

  let control: ReactNode;
  if (state.phase === "checking") {
    control = <span className="text-[12px] text-[var(--text-muted)]">Checking…</span>;
  } else if (state.phase === "downloading") {
    control = <span className="text-[12px] text-[var(--text-muted)]">Downloading… {state.pct}%</span>;
  } else if (state.phase === "ready") {
    control = <span className="text-[12px] font-medium text-[var(--text-primary)]">Restarting…</span>;
  } else if (state.phase === "available") {
    const r = state.r; // narrowed to native | fallback
    control = (
      <>
        <span className="text-[12px] font-medium text-[var(--text-primary)]">v{r.version} available</span>
        {r.kind === "native" ? (
          <button type="button" onClick={() => install(r.update, r.version)} className={accentBtn}>
            <Icon name="ph:arrow-down-bold" width={12} />
            Install &amp; restart
          </button>
        ) : (
          <button type="button" onClick={() => openInAppBrowserUrl(r.url)} className={accentBtn}>
            <Icon name="ph:arrow-square-out" width={12} />
            Open installer in Browser
          </button>
        )}
      </>
    );
  } else if (state.phase === "failed") {
    // The native install threw (e.g. unsigned/dev build, app translocation, or
    // a network/verification error). Don't dead-end: surface the reason and
    // keep recovery inside Cave.
    control = (
      <>
        <span
          className="text-[12px] font-medium text-[var(--color-danger)]"
          title={state.message}
        >
          Update failed
        </span>
        <button type="button" onClick={() => void openFallbackUpdateInBrowser()} className={accentBtn}>
          <Icon name="ph:arrow-square-out" width={12} />
          Open installer in Browser
        </button>
        <button
          type="button"
          onClick={check}
          className="rounded-md border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          Retry
        </button>
      </>
    );
  } else {
    control = (
      <>
        <span className="text-[12px] text-[var(--text-muted)]">Up to date</span>
        <button
          type="button"
          onClick={check}
          className="rounded-md border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          Check for updates
        </button>
      </>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[12px] text-[var(--text-secondary)]">Updates</span>
      <div className="flex items-center gap-2">{control}</div>
    </div>
  );
}

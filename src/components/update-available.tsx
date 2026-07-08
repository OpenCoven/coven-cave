"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
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

type NativeCheckResult =
  | { kind: "available"; update: TauriUpdate }
  | { kind: "current" }
  | { kind: "failed"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Try the native Tauri updater. Preserves plugin errors so the UI can
 * distinguish "native updater unavailable" from the intentional browser
 * installer fallback.
 */
async function checkNativeUpdate(): Promise<NativeCheckResult> {
  if (!isTauri()) return { kind: "current" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = (await check()) as TauriUpdate | null;
    if (!update) return { kind: "current" };
    // Older plugin versions expose `.available`; newer return null when none.
    if (update.available === false) return { kind: "current" };
    return { kind: "available", update };
  } catch (err) {
    return { kind: "failed", message: errorMessage(err, "Native updater check failed") };
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
 * After the signed native updater fails, do not route users to a direct
 * installer asset resolved from release metadata. Keep the recovery path on the
 * canonical GitHub release page so a verification/download failure cannot be
 * turned into a trusted-looking bypass of the signed updater path.
 */
function openReleasePageInBrowser(): void {
  openInAppBrowserUrl(RELEASES_PAGE);
}

type Resolved =
  | { kind: "current" }
  | { kind: "native"; version: string; update: TauriUpdate }
  | { kind: "native-unavailable"; version: string; url: string; message: string }
  | { kind: "fallback"; version: string; url: string };

/** Native-first, then fallback. Used by both the banner and the settings row. */
async function resolveUpdate(): Promise<Resolved> {
  const native = await checkNativeUpdate();
  if (native.kind === "available") {
    return { kind: "native", version: native.update.version, update: native.update };
  }
  const fb = await fetchFallbackStatus();
  if (fb?.available && fb.latest) {
    const url = await resolveDownloadUrl(fb);
    if (native.kind === "failed") {
      return { kind: "native-unavailable", version: fb.latest, url, message: native.message };
    }
    return { kind: "fallback", version: fb.latest, url };
  }
  return { kind: "current" };
}

// The cave is a long-running control-room app and releases ship several times
// a week, so a mount-only check would leave open instances permanently unaware
// of new versions. Re-check on this cadence (per-version dismissals still hold).
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Desktop-only. On mount and every RECHECK_INTERVAL_MS thereafter, checks for
 * an update and (if available and not dismissed for that version) shows a
 * dismissible shell banner. Renders nothing.
 */
export function UpdateBannerTrigger() {
  const isDesktop = useIsTauriDesktop();
  const { pushBanner, dismissBanner } = useShellBanners();

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    // While an install is downloading, a periodic re-check must not clobber
    // the progress banner (they share BANNER_ID) with a fresh "available" one.
    let installing = false;

    const runCheck = () => {
      if (installing) return;
      void resolveUpdate().then((r) => {
        if (cancelled || installing || r.kind === "current") return;
        if (isDismissed(r.version)) return;

        pushBanner({
          id: BANNER_ID,
          severity: r.kind === "native-unavailable" ? "warning" : "info",
          title:
            r.kind === "native-unavailable"
              ? `Native updater unavailable — v${r.version}`
              : `Update available — v${r.version}`,
          cta: {
            label: r.kind === "native" ? "Install & restart" : "Open installer in Browser",
            onClick: () => {
              if (r.kind === "native") {
                installing = true;
                pushBanner({ id: BANNER_ID, severity: "info", title: `Preparing update v${r.version}…` });
                void installNativeUpdate(r.update, (pct) => {
                  pushBanner({
                    id: BANNER_ID,
                    severity: "info",
                    title: `Downloading update v${r.version}… ${pct}%`,
                  });
                }).catch((err) => {
                  installing = false;
                  const reason = err instanceof Error ? err.message : "";
                  pushBanner({
                    id: BANNER_ID,
                    severity: "warning",
                    title: reason
                      ? `Update failed (${reason})`
                      : "Update failed",
                    cta: { label: "Open release page in Browser", onClick: openReleasePageInBrowser },
                    onDismiss: () => markDismissed(r.version),
                  });
                });
              } else if (r.kind === "native-unavailable") {
                openReleasePageInBrowser();
              } else {
                openInAppBrowserUrl(r.url);
              }
            },
          },
          onDismiss: () => markDismissed(r.version),
        });
      });
    };

    runCheck();
    const interval = window.setInterval(runCheck, RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      dismissBanner(BANNER_ID);
    };
  }, [isDesktop, pushBanner, dismissBanner]);

  return null;
}

type RowState =
  | { phase: "checking" }
  | { phase: "current" }
  | { phase: "available"; r: Extract<Resolved, { kind: "native" | "fallback" }> }
  | { phase: "native-unavailable"; r: Extract<Resolved, { kind: "native-unavailable" }> }
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
      else if (r.kind === "native-unavailable") setState({ phase: "native-unavailable", r });
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
    "rounded-[var(--radius-control)] bg-[var(--accent-presence)] px-3 py-1 text-[11px] font-semibold text-[var(--accent-presence-foreground)] transition-opacity hover:opacity-90";
  const secondaryBtn =
    "rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]";

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
          <Button variant="primary" size="xs" onClick={() => install(r.update, r.version)} className={accentBtn} leadingIcon="ph:arrow-down-bold">
            Install &amp; restart
          </Button>
        ) : (
          <Button variant="primary" size="xs" onClick={() => openInAppBrowserUrl(r.url)} className={accentBtn} leadingIcon="ph:arrow-square-out">
            Open installer in Browser
          </Button>
        )}
      </>
    );
  } else if (state.phase === "native-unavailable") {
    const r = state.r;
    control = (
      <>
        <span
          className="text-[12px] font-medium text-[var(--color-danger)]"
          title={r.message}
        >
          Native updater unavailable
        </span>
        <Button variant="primary" size="xs" onClick={check} className={accentBtn} leadingIcon="ph:arrow-clockwise-bold">
          Retry native update
        </Button>
        <Button
          variant="secondary"
          size="xs"
          onClick={openReleasePageInBrowser}
          className={secondaryBtn}
        >
          Open release page in Browser
        </Button>
      </>
    );
  } else if (state.phase === "failed") {
    // The native install threw (e.g. unsigned/dev build, app translocation, or
    // a network/verification error). Surface the reason and keep recovery on
    // the canonical release page rather than a direct installer asset.
    control = (
      <>
        <span
          className="text-[12px] font-medium text-[var(--color-danger)]"
          title={state.message}
        >
          Update failed
        </span>
        <Button
          variant="primary"
          size="xs"
          onClick={openReleasePageInBrowser}
          className={accentBtn}
          leadingIcon="ph:arrow-square-out"
        >
          Open release page in Browser
        </Button>
        <Button
          variant="secondary"
          size="xs"
          onClick={check}
          className={secondaryBtn}
        >
          Retry
        </Button>
      </>
    );
  } else {
    control = (
      <>
        <span className="text-[12px] text-[var(--text-muted)]">Up to date</span>
        <Button
          variant="secondary"
          size="xs"
          onClick={check}
          className={secondaryBtn}
        >
          Check for updates
        </Button>
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

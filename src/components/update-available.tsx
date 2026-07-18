"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isTauri, useIsTauriDesktop } from "@/lib/tauri-platform";
import { useShellBanners } from "@/lib/shell-banners";
import { openInAppBrowserUrl } from "@/lib/open-external";
import {
  classifyFallbackReleaseCheck,
  pickDownloadUrl,
  resolveFallbackAfterNative,
  type FallbackReleaseCheck,
  type UpdateStatus,
} from "@/lib/app-update";
import { relativeTime } from "@/lib/relative-time";
import {
  prepareNativeUpdate,
  releasePreparedUpdate,
  type CancellationSignal,
  type NativeUpdateHandle,
  type PreparationProgress,
} from "@/lib/native-update-preparation";
import {
  adoptNativeUpdateResult,
  nativeUpdateCoordinator,
} from "@/lib/native-update-coordinator";

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

type NativeCheckResult =
  | { kind: "available"; update: NativeUpdateHandle }
  | { kind: "current" }
  | { kind: "not-applicable" }
  | { kind: "failed"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Try the native Tauri updater. Preserves plugin errors so the UI can
 * distinguish "native updater unavailable" from the intentional browser
 * installer fallback.
 */
async function checkNativeUpdate(owner: symbol): Promise<NativeCheckResult> {
  if (!isTauri()) return { kind: "not-applicable" };
  const checkEpoch = nativeUpdateCoordinator.beginCheck();
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = (await check()) as NativeUpdateHandle | null;
    if (!update) {
      await nativeUpdateCoordinator.reportCurrent(checkEpoch);
      return { kind: "current" };
    }
    // Older plugin versions expose `.available`; newer return null when none.
    if (update.available === false) {
      await releasePreparedUpdate(update);
      await nativeUpdateCoordinator.reportCurrent(checkEpoch);
      return { kind: "current" };
    }
    return await adoptNativeUpdateResult(nativeUpdateCoordinator, owner, update, checkEpoch);
  } catch (err) {
    return { kind: "failed", message: errorMessage(err, "Native updater check failed") };
  }
}

/** Install an already downloaded and verified update, then relaunch where supported. */
async function installPreparedUpdate(update: NativeUpdateHandle): Promise<void> {
  await update.install();
  // Windows exits inside install() and AUTOLAUNCHAPP handles restart. Other
  // desktop platforms return and need an explicit relaunch.
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Lightweight fallback: ask the server route what the latest release is. */
async function fetchFallbackStatus(): Promise<FallbackReleaseCheck> {
  try {
    const res = await fetch("/api/app/latest-release", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    return classifyFallbackReleaseCheck(res.ok, body, res.status);
  } catch (err) {
    return {
      kind: "unavailable",
      message: errorMessage(err, "release check could not be reached"),
    };
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
  | { kind: "current"; source: "native" | "release"; checkedAt: string }
  | { kind: "unavailable"; message: string }
  | { kind: "native"; version: string; update: NativeUpdateHandle }
  | { kind: "native-unavailable"; version: string; url: string; message: string }
  | { kind: "fallback"; version: string; url: string };

/** Native-first, then fallback. Used by both the banner and the settings row. */
async function resolveUpdate(owner: symbol): Promise<Resolved> {
  const native = await checkNativeUpdate(owner);
  if (native.kind === "available") {
    return { kind: "native", version: native.update.version, update: native.update };
  }
  if (native.kind === "current") {
    // A successful signed-updater check is authoritative. Do not turn it into
    // an unknown result merely because the optional GitHub metadata lookup is
    // unavailable as well.
    return { kind: "current", source: "native", checkedAt: new Date().toISOString() };
  }

  const combined = resolveFallbackAfterNative(
    native.kind === "failed" ? native.message : null,
    await fetchFallbackStatus(),
  );
  if (combined.kind === "available") {
    const url = await resolveDownloadUrl(combined.status);
    if (combined.nativeUpdaterFailed) {
      return {
        kind: "native-unavailable",
        version: combined.status.latest!,
        url,
        message: native.kind === "failed" ? native.message : "Native updater check failed",
      };
    }
    return { kind: "fallback", version: combined.status.latest!, url };
  }
  if (combined.kind === "current") {
    return { kind: "current", source: "release", checkedAt: combined.status.checkedAt };
  }
  // A 200 release-route error body is deliberately classified as unavailable
  // here. No unsuccessful check can fall through to the confirmed-current UI.
  return combined;
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
  const owner = useRef(Symbol("update-banner")).current;

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    let busy = false;
    let activeCancellation: CancellationSignal | null = null;
    let preparedUpdate: NativeUpdateHandle | null = null;
    // Versions for which the user already clicked "Retry native update" in this session. Native
    // updater check failures are usually transient (e.g. latest.json not yet published mid-release),
    // so the banner offers a native retry first and only escalates to the browser release page if
    // the subsequent check is still `native-unavailable`.
    const nativeRetryFailed = new Set<string>();

    const runCheck = () => {
      if (busy) return;
      void resolveUpdate(owner).then((r) => {
        // "unavailable" (both checks unreachable) stays quiet here — the periodic
        // banner must not nag about connectivity; the Settings row reports it
        // honestly on an explicit check (cave-lsk4).
        if (cancelled) {
          if (r.kind === "native") void nativeUpdateCoordinator.release(owner);
          return;
        }
        if (busy || r.kind === "current" || r.kind === "unavailable") {
          if (r.kind === "native") void nativeUpdateCoordinator.release(owner);
          return;
        }
        if (isDismissed(r.version)) {
          if (r.kind === "native") void nativeUpdateCoordinator.release(owner);
          return;
        }

        if (r.kind !== "native-unavailable") nativeRetryFailed.delete(r.version);

        const recommendNativeRetry =
          r.kind === "native-unavailable" && !nativeRetryFailed.has(r.version);
        pushBanner({
          id: BANNER_ID,
          severity: r.kind === "native-unavailable" ? "warning" : "info",
          title:
            r.kind === "native-unavailable"
              ? recommendNativeRetry
                ? `Native updater unavailable — v${r.version}`
                : `Native updater still unavailable — v${r.version}`
              : `Update available — v${r.version}`,
          cta: {
            label:
              r.kind === "native"
                ? "Download update"
                : r.kind === "native-unavailable"
                  ? recommendNativeRetry
                    ? "Retry native update"
                    : "Open release page in Browser"
                  : "Open installer in Browser",
            onClick: () => {
              if (r.kind === "native") {
                if (busy) return;
                if (!nativeUpdateCoordinator.beginAction(owner, r.update)) {
                  pushBanner({
                    id: BANNER_ID,
                    severity: "info",
                    title: `Update v${r.version} is already being prepared in Settings`,
                  });
                  return;
                }
                busy = true;
                const cancellation: CancellationSignal = { cancelled: false };
                activeCancellation = cancellation;
                const requestCancel = () => {
                  cancellation.cancelled = true;
                  pushBanner({
                    id: BANNER_ID,
                    severity: "info",
                    title: `Cancelling update v${r.version} after verification…`,
                  });
                };
                pushBanner({
                  id: BANNER_ID,
                  severity: "info",
                  title: `Preparing update v${r.version}…`,
                  cta: { label: "Cancel", onClick: requestCancel },
                  onDismiss: requestCancel,
                });
                void prepareNativeUpdate(
                  r.update,
                  ({ phase, pct }) => {
                    if (cancelled || cancellation.cancelled) return;
                    pushBanner({
                      id: BANNER_ID,
                      severity: "info",
                      title:
                        phase === "verifying"
                          ? `Verifying update v${r.version}…`
                          : `Downloading update v${r.version}… ${pct}%`,
                      cta: { label: "Cancel", onClick: requestCancel },
                      onDismiss: requestCancel,
                    });
                  },
                  cancellation,
                ).then(async (result) => {
                  activeCancellation = null;
                  if (result === "cancelled" || cancelled) {
                    await nativeUpdateCoordinator.finishAction(owner);
                    await nativeUpdateCoordinator.invalidate(r.update);
                    busy = false;
                    markDismissed(r.version);
                    if (!cancelled) dismissBanner(BANNER_ID);
                    return;
                  }

                  preparedUpdate = r.update;
                  pushBanner({
                    id: BANNER_ID,
                    severity: "info",
                    title: `Update v${r.version} is verified and ready`,
                    cta: {
                      label: "Restart & install",
                      onClick: () => {
                        if (preparedUpdate !== r.update) return;
                        preparedUpdate = null;
                        pushBanner({
                          id: BANNER_ID,
                          severity: "info",
                          title: `Installing update v${r.version}…`,
                        });
                        void installPreparedUpdate(r.update).catch(async (error) => {
                          await nativeUpdateCoordinator.finishAction(owner);
                          await nativeUpdateCoordinator.invalidate(r.update);
                          busy = false;
                          preparedUpdate = null;
                          pushBanner({
                            id: BANNER_ID,
                            severity: "warning",
                            title: `Update failed (${errorMessage(error, "install failed")})`,
                            cta: {
                              label: "Open release page in Browser",
                              onClick: openReleasePageInBrowser,
                            },
                            onDismiss: () => markDismissed(r.version),
                          });
                        });
                      },
                    },
                    onDismiss: () => {
                      busy = false;
                      preparedUpdate = null;
                      markDismissed(r.version);
                      void nativeUpdateCoordinator
                        .finishAction(owner)
                        .then(() => nativeUpdateCoordinator.invalidate(r.update));
                    },
                  });
                }).catch(async (err) => {
                  await nativeUpdateCoordinator.finishAction(owner);
                  await nativeUpdateCoordinator.invalidate(r.update);
                  activeCancellation = null;
                  busy = false;
                  const reason = errorMessage(err, "");
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
                if (recommendNativeRetry) {
                  nativeRetryFailed.add(r.version);
                  dismissBanner(BANNER_ID);
                  runCheck();
                } else {
                  openReleasePageInBrowser();
                }
              } else {
                openInAppBrowserUrl(r.url);
              }
            },
          },
          onDismiss: () => {
            markDismissed(r.version);
            if (r.kind === "native") void nativeUpdateCoordinator.release(owner);
          },
        });
      });
    };

    const unsubscribe = nativeUpdateCoordinator.subscribe(() => {
      if (cancelled || busy) return;
      dismissBanner(BANNER_ID);
      runCheck();
    });
    runCheck();
    const interval = window.setInterval(runCheck, RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (activeCancellation) activeCancellation.cancelled = true;
      if (preparedUpdate) {
        const update = preparedUpdate;
        void nativeUpdateCoordinator
          .finishAction(owner)
          .then(() => nativeUpdateCoordinator.invalidate(update));
      } else if (!activeCancellation) {
        void nativeUpdateCoordinator.release(owner);
      }
      window.clearInterval(interval);
      unsubscribe();
      dismissBanner(BANNER_ID);
    };
  }, [isDesktop, pushBanner, dismissBanner]);

  return null;
}

type RowState =
  | { phase: "checking" }
  | { phase: "current"; checkedAt: string; source: "native" | "release" }
  | { phase: "unavailable"; message: string; stale: LastKnownUpdate | null }
  | { phase: "available"; r: Extract<Resolved, { kind: "native" | "fallback" }> }
  | { phase: "native-unavailable"; r: Extract<Resolved, { kind: "native-unavailable" }> }
  | { phase: "preparing"; version: string; stage: PreparationProgress["phase"]; pct: number }
  | { phase: "cancelling"; version: string }
  | { phase: "prepared"; version: string; update: NativeUpdateHandle }
  | { phase: "installing"; version: string }
  | { phase: "failed"; version: string; message: string };

type LastKnownUpdate =
  | { kind: "current"; checkedAt: string }
  | { kind: "available"; version: string; checkedAt: string };

/**
 * Settings ▸ About row. Desktop uses the signed native updater when available;
 * the web surface truthfully renders the same release-route fallback state.
 */
export function UpdateSettingsRow() {
  const [state, setState] = useState<RowState>({ phase: "checking" });
  const mounted = useRef(true);
  const activeCancellation = useRef<CancellationSignal | null>(null);
  const preparedUpdate = useRef<NativeUpdateHandle | null>(null);
  const owner = useRef(Symbol("update-settings")).current;
  const lastKnown = useRef<LastKnownUpdate | null>(null);
  const checkSequence = useRef(0);

  const check = useCallback(() => {
    const sequence = ++checkSequence.current;
    setState({ phase: "checking" });
    void resolveUpdate(owner).then((r) => {
      if (sequence !== checkSequence.current) return;
      if (!mounted.current) {
        if (r.kind === "native") void nativeUpdateCoordinator.release(owner);
        return;
      }
      if (r.kind === "current") {
        lastKnown.current = { kind: "current", checkedAt: r.checkedAt };
        setState({ phase: "current", checkedAt: r.checkedAt, source: r.source });
      } else if (r.kind === "unavailable") {
        setState({ phase: "unavailable", message: r.message, stale: lastKnown.current });
      } else if (r.kind === "native-unavailable") {
        lastKnown.current = { kind: "available", version: r.version, checkedAt: new Date().toISOString() };
        setState({ phase: "native-unavailable", r });
      } else {
        lastKnown.current = { kind: "available", version: r.version, checkedAt: new Date().toISOString() };
        setState({ phase: "available", r });
      }
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = nativeUpdateCoordinator.subscribe((snapshot) => {
      if (!mounted.current || activeCancellation.current || preparedUpdate.current) return;
      if (snapshot.update) {
        lastKnown.current = {
          kind: "available",
          version: snapshot.update.version,
          checkedAt: new Date().toISOString(),
        };
        setState({
          phase: "available",
          r: { kind: "native", version: snapshot.update.version, update: snapshot.update },
        });
      } else {
        const checkedAt = new Date().toISOString();
        lastKnown.current = { kind: "current", checkedAt };
        setState({ phase: "current", checkedAt, source: "native" });
      }
    });
    check();
    return () => {
      mounted.current = false;
      unsubscribe();
      if (activeCancellation.current) activeCancellation.current.cancelled = true;
      if (preparedUpdate.current) {
        nativeUpdateCoordinator.finishAction(owner);
        void nativeUpdateCoordinator.invalidate(preparedUpdate.current);
      } else if (!activeCancellation.current) {
        void nativeUpdateCoordinator.release(owner);
      }
    };
  }, [check]);

  const prepare = (update: NativeUpdateHandle, version: string) => {
    if (activeCancellation.current || preparedUpdate.current) return;
    if (!nativeUpdateCoordinator.beginAction(owner, update)) {
      setState({ phase: "failed", version, message: "Update preparation is active in another surface" });
      return;
    }
    const cancellation: CancellationSignal = { cancelled: false };
    activeCancellation.current = cancellation;
    setState({ phase: "preparing", version, stage: "downloading", pct: 0 });
    void prepareNativeUpdate(
      update,
      ({ phase, pct }) => {
        if (mounted.current && !cancellation.cancelled) {
          setState({ phase: "preparing", version, stage: phase, pct });
        }
      },
      cancellation,
    )
      .then(async (result) => {
        activeCancellation.current = null;
        if (!mounted.current) {
          await nativeUpdateCoordinator.finishAction(owner);
          await nativeUpdateCoordinator.invalidate(update);
          return;
        }
        if (result === "cancelled") {
          await nativeUpdateCoordinator.finishAction(owner);
          await nativeUpdateCoordinator.invalidate(update);
          check();
          return;
        }
        preparedUpdate.current = update;
        setState({ phase: "prepared", version, update });
      })
      .catch(async (err) => {
        await nativeUpdateCoordinator.finishAction(owner);
        await nativeUpdateCoordinator.invalidate(update);
        activeCancellation.current = null;
        if (mounted.current)
          setState({
            phase: "failed",
            version,
            message: err instanceof Error ? err.message : "Update failed",
          });
      });
  };

  const cancelPreparation = (version: string) => {
    if (!activeCancellation.current) return;
    activeCancellation.current.cancelled = true;
    setState({ phase: "cancelling", version });
  };

  const install = (update: NativeUpdateHandle, version: string) => {
    if (preparedUpdate.current !== update) return;
    preparedUpdate.current = null;
    setState({ phase: "installing", version });
    void installPreparedUpdate(update).catch(async (err) => {
      await nativeUpdateCoordinator.finishAction(owner);
      await nativeUpdateCoordinator.invalidate(update);
      if (mounted.current) {
        setState({
          phase: "failed",
          version,
          message: errorMessage(err, "Update failed"),
        });
      }
    });
  };

  const accentBtn =
    "rounded-[var(--radius-control)] bg-[var(--accent-presence)] px-3 py-1 text-[11px] font-semibold text-[var(--accent-presence-foreground)] transition-opacity hover:opacity-90";
  const secondaryBtn =
    "rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]";

  let control: ReactNode;
  if (state.phase === "checking") {
    control = <span className="text-[12px] text-[var(--text-muted)]">Checking…</span>;
  } else if (state.phase === "preparing") {
    control = (
      <>
        <span className="text-[12px] text-[var(--text-muted)]">
          {state.stage === "verifying" ? "Verifying signature…" : `Downloading… ${state.pct}%`}
        </span>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => cancelPreparation(state.version)}
          className={secondaryBtn}
        >
          Cancel
        </Button>
      </>
    );
  } else if (state.phase === "cancelling") {
    control = (
      <span className="text-[12px] text-[var(--text-muted)]">
        Cancelling after verification…
      </span>
    );
  } else if (state.phase === "prepared") {
    control = (
      <>
        <span className="text-[12px] font-medium text-[var(--text-primary)]">
          v{state.version} verified
        </span>
        <Button
          variant="primary"
          size="xs"
          onClick={() => install(state.update, state.version)}
          className={accentBtn}
          leadingIcon="ph:arrow-clockwise-bold"
        >
          Restart &amp; install
        </Button>
      </>
    );
  } else if (state.phase === "installing") {
    control = <span className="text-[12px] font-medium text-[var(--text-primary)]">Installing…</span>;
  } else if (state.phase === "available") {
    const r = state.r; // narrowed to native | fallback
    control = (
      <>
        <span className="text-[12px] font-medium text-[var(--text-primary)]">v{r.version} available</span>
        {r.kind === "native" ? (
          <Button variant="primary" size="xs" onClick={() => prepare(r.update, r.version)} className={accentBtn} leadingIcon="ph:arrow-down-bold">
            Download update
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
  } else if (state.phase === "unavailable") {
    // Both the native check and the fallback fetch failed — we could not
    // verify anything, so don't claim currency (cave-lsk4).
    control = (
      <>
        <span className="text-[12px] text-[var(--color-warning)]" title={state.message}>
          Couldn&apos;t check — you may be offline
        </span>
        {state.stale ? (
          <span className="text-[11px] text-[var(--text-muted)]">
            Last known {state.stale.kind === "current" ? "current" : `v${state.stale.version} available`} · {relativeTime(state.stale.checkedAt)}
          </span>
        ) : null}
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
        <span className="text-[12px] text-[var(--text-muted)]" title={state.checkedAt}>
          Up to date · confirmed {relativeTime(state.checkedAt)}
        </span>
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

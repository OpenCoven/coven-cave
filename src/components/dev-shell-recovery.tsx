"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DevShellRecoveryState,
  createDevShellRecovery,
} from "@/lib/dev-shell-recovery";

import "@/styles/dev-shell-recovery.css";

const HEARTBEAT_INTERVAL_MS = 5_000;
const RELOAD_MARKER_KEY = "coven-cave:dev-shell-recovery:reloaded-at";

async function probeOrigin(): Promise<boolean> {
  try {
    // Any answer at all proves the dev server is back; the status does not
    // matter, only that the loopback origin is no longer refusing connections.
    await fetch(`${window.location.origin}/?__devShellProbe=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps the desktop dev window from sitting silently on a dead loopback origin.
 * Without this the window keeps the last-rendered document forever, and the
 * first navigation reports a raw ChunkLoadError or ERR_CONNECTION_REFUSED with
 * no way back short of hunting the process tree by hand.
 */
export function DevShellRecovery() {
  // A build-time constant, so production drops the overlay and its heartbeat.
  if (process.env.NODE_ENV !== "development") return null;
  return <DevShellRecoveryOverlay />;
}

function DevShellRecoveryOverlay() {
  const [state, setState] = useState<DevShellRecoveryState>("healthy");
  const [reloadBlocked, setReloadBlocked] = useState(false);
  const controllerRef = useRef<ReturnType<typeof createDevShellRecovery> | null>(null);

  useEffect(() => {
    const controller = createDevShellRecovery({
      probe: probeOrigin,
      reload: () => window.location.reload(),
      onStateChange: (next) => {
        setState(next);
        setReloadBlocked(controllerRef.current?.reloadBlocked ?? false);
      },
      readLastReloadAt: () => {
        const raw = window.sessionStorage.getItem(RELOAD_MARKER_KEY);
        const parsed = raw === null ? Number.NaN : Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
      },
      writeLastReloadAt: (at) => {
        window.sessionStorage.setItem(RELOAD_MARKER_KEY, String(at));
      },
    });
    controllerRef.current = controller;

    const onError = (event: ErrorEvent) => controller.report(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => controller.report(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // The passive listeners above only fire when the app happens to reach for
    // the server, so poll as well: a window left idle must still notice.
    const heartbeat = window.setInterval(() => {
      if (document.hidden) return;
      void probeOrigin().then((reachable) => {
        if (!reachable) controller.observeOriginLost();
      });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      controller.stop();
      controllerRef.current = null;
    };
  }, []);

  const retry = useCallback(() => {
    controllerRef.current?.retry();
    setReloadBlocked(false);
  }, []);

  if (state === "healthy") return null;
  const reloading = state === "reloading";
  const body = reloading
    ? "The dev server answered. Reloading to pick up the new build."
    : reloadBlocked
      ? "Reloading did not clear the failure, so Cave stopped retrying. Restart the dev server, then reconnect."
      : "The dev server stopped answering. Cave will reconnect on its own as soon as it comes back.";

  return (
    <div className="dev-shell-recovery" role="alert" aria-live="assertive">
      <div className="dev-shell-recovery__card">
        <h2 className="dev-shell-recovery__title">Dev server unreachable</h2>
        <p className="dev-shell-recovery__body">{body}</p>
        <p className="dev-shell-recovery__origin">{typeof window === "undefined" ? "" : window.location.origin}</p>
        {!reloading ? (
          <div className="dev-shell-recovery__actions">
            <button type="button" className="dev-shell-recovery__button focus-ring" onClick={retry}>
              Reconnect
            </button>
          </div>
        ) : null}
        <p className="dev-shell-recovery__status">
          <span className="dev-shell-recovery__pulse" aria-hidden="true" />
          {state === "checking" ? "Checking the dev server…" : null}
          {state === "unreachable" && !reloadBlocked ? "Waiting for the dev server…" : null}
          {state === "unreachable" && reloadBlocked ? "Paused after a failed reload." : null}
          {reloading ? "Reloading…" : null}
        </p>
      </div>
    </div>
  );
}

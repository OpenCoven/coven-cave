"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { useIsTauriDesktop } from "@/lib/tauri-platform";
import { useShellBanners } from "@/lib/shell-banners";
import { openExternalUrl } from "@/lib/open-external";
import type { UpdateStatus } from "@/lib/app-update";

const BANNER_ID = "update-available";
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

async function fetchUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    const res = await fetch("/api/app/latest-release", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as UpdateStatus;
  } catch {
    return null;
  }
}

/**
 * Desktop-only. Checks for a newer release on mount and, if one is available and
 * hasn't been dismissed for that version, pushes a dismissible shell banner.
 * Renders nothing. Mount once inside <ShellBannersProvider>.
 */
export function UpdateBannerTrigger() {
  const isDesktop = useIsTauriDesktop();
  const { pushBanner, dismissBanner } = useShellBanners();

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void fetchUpdateStatus().then((status) => {
      if (cancelled || !status?.available || !status.latest) return;
      if (isDismissed(status.latest)) return;
      const latest = status.latest;
      pushBanner({
        id: BANNER_ID,
        severity: "info",
        title: `Update available — v${latest}`,
        cta: { label: "Download", onClick: () => void openExternalUrl(status.url) },
        onDismiss: () => markDismissed(latest),
      });
    });
    return () => {
      cancelled = true;
      // Drop the banner if this trigger unmounts (e.g. shell teardown).
      dismissBanner(BANNER_ID);
    };
  }, [isDesktop, pushBanner, dismissBanner]);

  return null;
}

/**
 * Desktop-only row for Settings ▸ About. Shows the current update state and a
 * Download (when newer) or Check (when current) action. Renders nothing on web.
 */
export function UpdateSettingsRow() {
  const isDesktop = useIsTauriDesktop();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(() => {
    setChecking(true);
    void fetchUpdateStatus()
      .then((s) => setStatus(s))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (isDesktop) check();
  }, [isDesktop, check]);

  if (!isDesktop) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[12px] text-[var(--text-secondary)]">Updates</span>
      <div className="flex items-center gap-2">
        {checking ? (
          <span className="text-[12px] text-[var(--text-muted)]">Checking…</span>
        ) : status?.available && status.latest ? (
          <>
            <span className="text-[12px] font-medium text-[var(--text-primary)]">
              v{status.latest} available
            </span>
            <button
              type="button"
              onClick={() => void openExternalUrl(status.url)}
              className="flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Icon name="ph:arrow-square-out" width={12} />
              Download
            </button>
          </>
        ) : (
          <>
            <span className="text-[12px] text-[var(--text-muted)]">
              {status?.error ? "Check failed" : "Up to date"}
            </span>
            <button
              type="button"
              onClick={check}
              className="rounded-md border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            >
              Check for updates
            </button>
          </>
        )}
      </div>
    </div>
  );
}

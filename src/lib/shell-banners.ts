"use client";

import { createElement, createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type BannerSeverity = "error" | "warning" | "info";

export type ShellBanner = {
  id: string;
  severity: BannerSeverity;
  title: string;
  /** Diagnostic text (e.g. an OS error string) shown behind a "Details"
   *  disclosure, so the headline stays plain. */
  detail?: string;
  cta?: { label: string; onClick: () => void };
  /** Called when the user dismisses the banner (before it's removed). Lets a
   *  pusher persist the dismissal (e.g. "don't show this version again"). */
  onDismiss?: () => void;
};

type Ctx = {
  banners: ShellBanner[];
  pushBanner: (b: ShellBanner) => void;
  dismissBanner: (id: string) => void;
};

const ShellBannersContext = createContext<Ctx | null>(null);

const SEVERITY_RANK: Record<BannerSeverity, number> = { error: 0, warning: 1, info: 2 };

export function ShellBannersProvider({ children }: { children: ReactNode }) {
  const [banners, setBanners] = useState<ShellBanner[]>([]);

  const pushBanner = useCallback((b: ShellBanner) => {
    setBanners((prev) => {
      const without = prev.filter((p) => p.id !== b.id);
      return [...without, b];
    });
  }, []);

  const dismissBanner = useCallback((id: string) => {
    setBanners((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const sortedBanners = useMemo(
    () => [...banners].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    ),
    [banners],
  );

  const value = useMemo<Ctx>(
    () => ({ banners: sortedBanners, pushBanner, dismissBanner }),
    [sortedBanners, pushBanner, dismissBanner],
  );

  return createElement(ShellBannersContext.Provider, { value }, children);
}

export function useShellBanners(): Ctx {
  const ctx = useContext(ShellBannersContext);
  if (!ctx) throw new Error("useShellBanners must be used inside ShellBannersProvider");
  return ctx;
}

/** Shell banners that already report the daemon itself as unreachable or
 *  offline. A surface whose own load failed for that reason should not stack
 *  a second warning under them (#5530). */
export const DAEMON_SHELL_BANNER_IDS: readonly string[] = ["daemon-status-unavailable", "daemon-offline"];

export function hasDaemonShellBanner(banners: readonly Pick<ShellBanner, "id">[]): boolean {
  return banners.some((banner) => DAEMON_SHELL_BANNER_IDS.includes(banner.id));
}

/** Whether a daemon banner is showing. Unlike useShellBanners() this is safe
 *  outside ShellBannersProvider (isolated renders and tests), where it is false. */
export function useDaemonShellBannerVisible(): boolean {
  const ctx = useContext(ShellBannersContext);
  return ctx ? hasDaemonShellBanner(ctx.banners) : false;
}

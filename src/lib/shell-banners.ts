"use client";

import { createElement, createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type BannerSeverity = "error" | "warning" | "info";

export type ShellBanner = {
  id: string;
  severity: BannerSeverity;
  title: string;
  cta?: { label: string; onClick: () => void };
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

  const value = useMemo<Ctx>(() => ({
    banners: [...banners].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    ),
    pushBanner: (b) => {
      setBanners((prev) => {
        const without = prev.filter((p) => p.id !== b.id);
        return [...without, b];
      });
    },
    dismissBanner: (id) => {
      setBanners((prev) => prev.filter((p) => p.id !== id));
    },
  }), [banners]);

  return createElement(ShellBannersContext.Provider, { value }, children);
}

export function useShellBanners(): Ctx {
  const ctx = useContext(ShellBannersContext);
  if (!ctx) throw new Error("useShellBanners must be used inside ShellBannersProvider");
  return ctx;
}

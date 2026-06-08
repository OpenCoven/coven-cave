"use client";

import { useEffect } from "react";
import { useShellBanners } from "@/lib/shell-banners";

const TOKEN_PARAM = "covenCaveToken";
const STORAGE_KEY = "coven-cave:sidecar-auth-token";
const BANNER_ID = "sidecar-auth-failed";

// Client companion for SidecarAuthBridge. The inline script runs before React
// hydrates; this surfaces missing-token failures in the shell after mount.
export function SidecarAuthMonitor() {
  const { pushBanner, dismissBanner } = useShellBanners();

  useEffect(() => {
    // No sidecar exists in plain-browser dev (next dev outside Tauri), so a
    // missing token there is expected — skip the check to avoid noisy console
    // errors and a permanently-pinned banner during web preview.
    const inTauri =
      typeof window !== "undefined" &&
      // @ts-expect-error Tauri injects this at runtime
      Boolean(window.__TAURI_INTERNALS__);
    if (!inTauri) {
      dismissBanner(BANNER_ID);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const token =
      params.get(TOKEN_PARAM) ?? window.sessionStorage.getItem(STORAGE_KEY);

    if (!token) {
      console.error(
        "[SidecarAuthBridge] No sidecar auth token found - local APIs will not be authenticated.",
      );
      pushBanner({
        id: BANNER_ID,
        severity: "error",
        title: "Sidecar authentication failed - local APIs may not work.",
        cta: {
          label: "Open settings",
          onClick: () => {
            window.location.href = "/settings";
          },
        },
      });
    } else {
      dismissBanner(BANNER_ID);
    }
  }, [pushBanner, dismissBanner]);

  return null;
}

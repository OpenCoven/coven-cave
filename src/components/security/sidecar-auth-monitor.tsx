"use client";

import { useEffect } from "react";
import { useShellBanners } from "@/lib/shell-banners";
import { useIsTauriDesktop } from "@/lib/tauri-platform";

const TOKEN_PARAM = "covenCaveToken";
const STORAGE_KEY = "coven-cave:sidecar-auth-token";
const BANNER_ID = "sidecar-auth-failed";
const AUTH_REQUIRED_KEY = "__COVEN_CAVE_SIDECAR_AUTH_REQUIRED__";

type SidecarAuthWindow = Window & {
  __COVEN_CAVE_SIDECAR_AUTH_REQUIRED__?: boolean;
};

// Client companion for SidecarAuthBridge. The inline script runs before React
// hydrates; this surfaces missing-token failures in the shell after mount.
export function SidecarAuthMonitor() {
  const { pushBanner, dismissBanner } = useShellBanners();
  const isTauriDesktop = useIsTauriDesktop();

  useEffect(() => {
    const sidecarAuthRequired = Boolean((window as SidecarAuthWindow)[AUTH_REQUIRED_KEY]);

    // Only desktop Tauri has a local sidecar. Browser dev and mobile Tauri use
    // remote/webview paths, so a missing sidecar token is expected there. Tauri
    // desktop dev can also point at a tokenless live dev server.
    if (!isTauriDesktop || !sidecarAuthRequired) {
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
  }, [pushBanner, dismissBanner, isTauriDesktop]);

  return null;
}

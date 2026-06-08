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

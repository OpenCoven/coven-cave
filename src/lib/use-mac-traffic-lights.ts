"use client";

import { useEffect } from "react";
import { isMacDesktopShell } from "@/lib/tauri-platform";

let ownerCount = 0;
let restoreTimer: number | null = null;

function setNativeTrafficLightsVisible(visible: boolean): Promise<unknown> {
  return import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke("set_traffic_lights_visible", { visible }),
  );
}

function reportTrafficLightError(action: string, error: unknown): void {
  console.warn(`[traffic-lights] Failed to ${action}.`, error);
}

export function useMacTrafficLightsForNavState(visible: boolean): void {
  useEffect(() => {
    if (!isMacDesktopShell()) return;

    ownerCount += 1;
    if (restoreTimer !== null) {
      window.clearTimeout(restoreTimer);
      restoreTimer = null;
    }

    const root = document.documentElement;
    let cancelled = false;

    if (visible) {
      root.dataset.trafficLights = "visible";
      void setNativeTrafficLightsVisible(true).catch((error: unknown) => {
        reportTrafficLightError("show native window controls", error);
      });
    } else {
      void setNativeTrafficLightsVisible(false)
        .then(() => {
          if (!cancelled) root.dataset.trafficLights = "hidden";
        })
        .catch((error: unknown) => {
          if (!cancelled) root.dataset.trafficLights = "visible";
          reportTrafficLightError("hide native window controls", error);
        });
    }

    const onFocus = () => {
      if (visible) return;
      void setNativeTrafficLightsVisible(false).catch((error: unknown) => {
        reportTrafficLightError("restore hidden native window controls after focus", error);
      });
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      ownerCount = Math.max(0, ownerCount - 1);
      if (ownerCount !== 0) return;
      restoreTimer = window.setTimeout(() => {
        restoreTimer = null;
        if (ownerCount !== 0) return;
        root.dataset.trafficLights = "visible";
        void setNativeTrafficLightsVisible(true).catch((error: unknown) => {
          reportTrafficLightError("restore native window controls", error);
        });
      }, 0);
    };
  }, [visible]);
}

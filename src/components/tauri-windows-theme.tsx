"use client";

import { useEffect } from "react";
import { isTauri } from "@/lib/tauri-platform";

/** Windows decorations follow the resolved app mode, not the OS taskbar mode. */
export function TauriWindowsTheme() {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let observer: MutationObserver | undefined;
    void (async () => {
      try {
        const { platform } = await import("@tauri-apps/plugin-os");
        if (await platform() !== "windows" || disposed) return;
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (disposed) return;
        const nativeWindow = getCurrentWindow();
        const root = document.documentElement;
        let pending = false;
        let wanted: "dark" | "light" | undefined;
        let applied: "dark" | "light" | undefined;
        const drain = async () => {
          if (pending || disposed) return;
          pending = true;
          try {
            while (wanted && !disposed) {
              const mode = wanted;
              wanted = undefined;
              if (mode === applied) continue;
              try {
                await nativeWindow.setTheme(mode);
                applied = mode;
              } catch (error) {
                console.warn("[titlebar] Couldn't synchronize Windows appearance.", error);
              }
            }
          } finally {
            pending = false;
          }
        };
        const sync = () => {
          if (disposed) return;
          const mode = root.getAttribute("data-mode");
          if (mode !== "dark" && mode !== "light") return;
          wanted = mode;
          void drain();
        };
        observer = new MutationObserver(sync);
        observer.observe(root, { attributes: true, attributeFilter: ["data-mode"] });
        sync();
      } catch (error) {
        if (!disposed) console.warn("[titlebar] Couldn't initialize Windows appearance.", error);
      }
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, []);
  return null;
}

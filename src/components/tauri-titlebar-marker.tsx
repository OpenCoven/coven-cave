"use client";

/**
 * Global owner of the `data-tauri-titlebar` root marker.
 *
 * The macOS desktop shell renders the main window's native title bar as an
 * Overlay (lib.rs), so the traffic lights float over web content on EVERY
 * route of the window — not just the workspace shell. The marker used to be
 * set by <Shell>, which meant full-window routes (/settings, /dashboard,
 * analytics, reports) lost it the moment the shell unmounted and their title
 * bands slid their leading controls underneath the lights.
 *
 * Mounted once in the root layout; the overlay title bar is a property of
 * the window, not of a route, so the marker is never removed. globals.css
 * (and dashboard.css) key their traffic-light insets and titlebar glass off
 * `:root[data-tauri-titlebar]`. Browser, Windows, Linux, and Tauri-mobile
 * never set it.
 */

import { useEffect } from "react";
import { isMacDesktopShell } from "@/lib/tauri-platform";

export function TauriTitlebarMarker() {
  useEffect(() => {
    if (!isMacDesktopShell()) return;
    document.documentElement.dataset.tauriTitlebar = "";
  }, []);
  return null;
}

"use client";

import { CAVE_ICON_SIZE, Icon } from "@/lib/icon";
import { moveSurfaceHistory } from "@/lib/surface-history";

/**
 * Shared browser-history controls for the standalone shells.
 *
 * Standalone pages (Settings, Analytics, Familiars) have no Workspace above
 * them to own a mode stack, so these fall through to the browser. They still
 * step the in-surface journal first: on Settings, Back should leave the section
 * you opened before leaving the page entirely.
 */
export function DesktopHistoryNav() {
  return (
    <div className="shell-top-history" role="group" aria-label="History">
      <button
        type="button"
        className="shell-top-toggle focus-ring"
        aria-label="Go back"
        title="Back"
        onClick={() => {
          if (moveSurfaceHistory(-1)) return;
          window.history.back();
        }}
      >
        <Icon name="ph:caret-left" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} />
      </button>
      <button
        type="button"
        className="shell-top-toggle focus-ring"
        aria-label="Go forward"
        title="Forward"
        onClick={() => {
          if (moveSurfaceHistory(1)) return;
          window.history.forward();
        }}
      >
        <Icon name="ph:caret-right" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} />
      </button>
    </div>
  );
}

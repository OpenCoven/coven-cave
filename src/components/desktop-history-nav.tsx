"use client";

import { CAVE_ICON_SIZE, Icon } from "@/lib/icon";

/** Shared browser-history controls for the workspace and standalone shells. */
export function DesktopHistoryNav() {
  return (
    <div className="shell-top-history" role="group" aria-label="History">
      <button
        type="button"
        className="shell-top-toggle focus-ring"
        aria-label="Go back"
        title="Back"
        onClick={() => window.history.back()}
      >
        <Icon name="ph:caret-left" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} />
      </button>
      <button
        type="button"
        className="shell-top-toggle focus-ring"
        aria-label="Go forward"
        title="Forward"
        onClick={() => window.history.forward()}
      >
        <Icon name="ph:caret-right" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} />
      </button>
    </div>
  );
}

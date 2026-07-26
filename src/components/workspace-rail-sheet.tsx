"use client";

import { WorkspaceRail } from "@/components/lazy-surfaces";
import type { Familiar } from "@/lib/types";
import type { WorkspaceRailController } from "@/lib/use-workspace-rail-controller";

export function WorkspaceRailSheet({
  controller,
  familiar,
  sessionId,
}: {
  controller: WorkspaceRailController;
  familiar: Familiar | null;
  sessionId: string | null;
}) {
  if (!controller.mobileAvailable || !controller.mobileOpen) return null;
  return (
    <div className="mobile-code-rail-sheet fixed inset-0 z-[200] flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close code rail"
        className="absolute inset-0 bg-[var(--backdrop-scrim)]"
        onClick={controller.closeMobile}
      />
      <div
        ref={controller.mobileSheetRef}
        className="mobile-code-rail-sheet__panel relative flex h-full w-[min(92vw,420px)] flex-col bg-[var(--bg-raised)] shadow-[-8px_0_32px_rgba(0,0,0,0.2)] [padding-bottom:var(--sai-bottom)] [padding-top:var(--sai-top)]"
        role="dialog"
        aria-modal="true"
        aria-label="Code rail"
        tabIndex={-1}
      >
        <WorkspaceRail
          changeCount={controller.changeCount ?? 0}
          activeTab={controller.rail.activeTab}
          pinned={controller.rail.pinned}
          projectRoot={controller.effectiveProjectRoot}
          familiarId={familiar?.id ?? null}
          sessionId={sessionId}
          focus={controller.focus}
          hidePin
          onSelectTab={controller.rail.setActiveTab}
          onTogglePin={controller.rail.togglePin}
          onCollapse={controller.closeMobile}
        />
      </div>
    </div>
  );
}

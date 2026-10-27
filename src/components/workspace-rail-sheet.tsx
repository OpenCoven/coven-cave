"use client";

import "@/styles/workspace-rail-sheet.css";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
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
  const [fullscreen, setFullscreen] = useState(false);
  const open = controller.mobileAvailable && controller.mobileOpen;
  useEffect(() => { if (!open) setFullscreen(false); }, [open]);
  const close = () => { setFullscreen(false); controller.closeMobile(); };
  if (!open) return null;
  return (
    <Modal open onClose={close} title="Code rail" size={fullscreen ? "workspace" : "compact"} presentation={fullscreen ? "fullscreen" : "sheet-right"} bodyLayout="fill">
        <WorkspaceRail
          changeCount={controller.changeCount ?? 0}
          activeTab={controller.rail.activeTab}
          pinned={controller.rail.pinned}
          projectRoot={controller.effectiveProjectRoot}
          familiarId={familiar?.id ?? null}
          sessionId={sessionId}
          focus={controller.focus}
          hidePin
          hostedFullscreen
          onFullscreenChange={setFullscreen}
          onSelectTab={controller.rail.setActiveTab}
          onTogglePin={controller.rail.togglePin}
          onCollapse={close}
        />
    </Modal>
  );
}

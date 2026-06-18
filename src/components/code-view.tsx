"use client";

import type { ReactNode } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useIsMobile } from "@/lib/use-viewport";

const CODE_GROUP_ID = "cave.code.widths.v1";

const codeStorage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore — strict privacy mode or storage quota */
    }
  },
};

type Props = {
  /** Familiar conversation pane (left). */
  chat: ReactNode;
  /** Code pane (right): the comux surface — file tree + editable preview +
   *  terminal + project search. */
  comux: ReactNode;
};

/**
 * Unified Code workspace (mode "code"): a familiar chat on the left beside the
 * full comux coding surface on the right, in one resizable two-pane split. A
 * thin layout shell — both panes are existing components (ChatSurface,
 * ComuxView) composed here, not rewritten. The split width persists under its
 * own storage key, independent of the chat surface's and shell's layouts.
 */
export function CodeView({ chat, comux }: Props) {
  const isMobile = useIsMobile();
  // On mobile a side-by-side split is unusable, so the comux pane drops out and
  // the chat fills the surface. panelIds tracks the mounted panels so the
  // two-pane and chat-only layouts persist independently (no clobbering).
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: CODE_GROUP_ID,
    panelIds: isMobile ? ["code-chat"] : ["code-chat", "code-comux"],
    storage: codeStorage,
  });

  return (
    <Group
      className="flex min-h-0 min-w-0 flex-1"
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel id="code-chat" className="flex min-h-0 min-w-0" defaultSize="38%" minSize="28%" maxSize={isMobile ? undefined : "60%"}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chat}</div>
      </Panel>
      {!isMobile && (
        <>
          <Separator className="shell-separator hidden lg:flex">
            <SeparatorHandle orientation="col" />
          </Separator>
          <Panel id="code-comux" className="hidden min-h-0 min-w-0 lg:flex" minSize="35%">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">{comux}</div>
          </Panel>
        </>
      )}
    </Group>
  );
}

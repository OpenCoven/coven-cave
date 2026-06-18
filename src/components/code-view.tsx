"use client";

import { useState, type ReactNode } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Icon } from "@/lib/icon";
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
type MobileTab = "chat" | "code";

export function CodeView({ chat, comux }: Props) {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");

  // Mobile: a side-by-side split is unusable on a phone, so show one pane
  // full-screen with a Chat / Code segmented switcher. Both panes stay mounted
  // (hidden, not unmounted) so the terminal/chat keep their state across taps.
  if (isMobile) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-center gap-1 border-b border-[var(--border-hairline)] p-1.5">
          <div className="flex items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 p-0.5 text-[11px]">
            {(["chat", "code"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMobileTab(tab)}
                aria-pressed={mobileTab === tab}
                className={`flex items-center gap-1.5 rounded-[5px] px-3 py-1 transition-colors ${
                  mobileTab === tab
                    ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <Icon name={tab === "chat" ? "ph:chats" : "ph:code"} width={13} />
                {tab === "chat" ? "Chat" : "Code"}
              </button>
            ))}
          </div>
        </div>
        <div className={`min-h-0 flex-1 flex-col ${mobileTab === "chat" ? "flex" : "hidden"}`}>{chat}</div>
        <div className={`min-h-0 flex-1 flex-col ${mobileTab === "code" ? "flex" : "hidden"}`}>{comux}</div>
      </div>
    );
  }

  return (
    <DesktopCodeView chat={chat} comux={comux} />
  );
}

function DesktopCodeView({ chat, comux }: Props) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: CODE_GROUP_ID,
    panelIds: ["code-chat", "code-comux"],
    storage: codeStorage,
  });

  return (
    <Group
      className="flex min-h-0 min-w-0 flex-1"
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel id="code-chat" className="flex min-h-0 min-w-0" defaultSize="38%" minSize="28%" maxSize="60%">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chat}</div>
      </Panel>
      <Separator className="shell-separator hidden lg:flex">
        <SeparatorHandle orientation="col" />
      </Separator>
      <Panel id="code-comux" className="hidden min-h-0 min-w-0 lg:flex" minSize="35%">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{comux}</div>
      </Panel>
    </Group>
  );
}

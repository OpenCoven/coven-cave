"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { useIsMobile } from "@/lib/use-viewport";
import {
  CODE_PRESET_CHAT_SIZE,
  CODE_PRESET_EVENT,
  readCodePreset,
  type CodePreset,
} from "@/lib/code-layout-preset";

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
          <Tabs
            variant="segment"
            size="sm"
            ariaLabel="Code view"
            value={mobileTab}
            onChange={setMobileTab}
            items={[
              { id: "chat", label: "Chat", icon: "ph:chats" },
              { id: "code", label: "Code", icon: "ph:code" },
            ]}
          />
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
  const chatPanelRef = usePanelRef();

  useEffect(() => {
    // Apply the stored preset's width ONLY on a first-ever load (no dragged
    // layout persisted yet), so we never clobber a manual drag on reload — the
    // "default only when unstored" idiom. After this, useDefaultLayout restores
    // the persisted sizes.
    if (codeStorage.getItem(CODE_GROUP_ID) == null) {
      chatPanelRef.current?.resize(CODE_PRESET_CHAT_SIZE[readCodePreset()]);
    }
    // The preset chips now live on the chat surface's tab row (CodeInlineToolbar)
    // and broadcast CODE_PRESET_EVENT; here we own the chat-pane resize. Going
    // through onLayoutChanged persists the size, and there's no remount so the
    // comux terminals/file preview keep their state.
    const onPreset = (e: Event) => {
      const preset = (e as CustomEvent<{ preset?: CodePreset }>).detail?.preset;
      if (preset) chatPanelRef.current?.resize(CODE_PRESET_CHAT_SIZE[preset]);
    };
    window.addEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    return () => window.removeEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Group
        className="flex min-h-0 min-w-0 flex-1"
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel
          panelRef={chatPanelRef}
          id="code-chat"
          className="flex min-h-0 min-w-0"
          defaultSize="38%"
          minSize="28%"
          maxSize="75%"
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chat}</div>
        </Panel>
        <Separator className="shell-separator hidden lg:flex">
          <SeparatorHandle orientation="col" />
        </Separator>
        <Panel id="code-comux" className="hidden min-h-0 min-w-0 lg:flex" minSize="35%">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{comux}</div>
        </Panel>
      </Group>
    </div>
  );
}

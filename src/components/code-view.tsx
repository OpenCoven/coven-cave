"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Icon } from "@/lib/icon";
import { useIsMobile } from "@/lib/use-viewport";
import {
  CODE_PRESET_CHAT_SIZE,
  CODE_PRESET_EVENT,
  CODE_PRESET_HIDES_PROJECT_LIST,
  CODE_PRESET_HINTS,
  CODE_PRESET_ICONS,
  CODE_PRESET_LABELS,
  CODE_PRESETS,
  CODE_PROJECT_LIST_EVENT,
  DEFAULT_CODE_PRESET,
  readCodePreset,
  readProjectListCollapsed,
  writeCodePreset,
  writeProjectListCollapsed,
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
  const chatPanelRef = usePanelRef();
  // Tracks the highlighted chip. The actual sizes live in the panels' own
  // persisted layout (CODE_GROUP_ID); this only records the last preset chosen.
  const [preset, setPreset] = useState<CodePreset>(DEFAULT_CODE_PRESET);
  // Whether the comux *projects list* (the 200px column inside the code pane)
  // is hidden — NOT the whole code pane. The comux surface owns the actual
  // column; we mirror the boolean here for the toolbar's pressed state and
  // drive it over CODE_PROJECT_LIST_EVENT.
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);

  useEffect(() => {
    setPreset(readCodePreset());
    setProjectsCollapsed(readProjectListCollapsed());
    // Apply the stored preset's width ONLY on a first-ever load (no dragged
    // layout persisted yet), so we never clobber a manual drag on reload — the
    // "default only when unstored" idiom. After this, useDefaultLayout restores
    // the persisted sizes and the chip is purely cosmetic until the next click.
    if (codeStorage.getItem(CODE_GROUP_ID) == null) {
      chatPanelRef.current?.resize(CODE_PRESET_CHAT_SIZE[readCodePreset()]);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show/hide the comux projects list. Persists and notifies comux-view; the
  // code pane itself is never collapsed.
  const setProjectList = (collapsed: boolean) => {
    setProjectsCollapsed(collapsed);
    writeProjectListCollapsed(collapsed);
    window.dispatchEvent(new CustomEvent(CODE_PROJECT_LIST_EVENT, { detail: { collapsed } }));
  };

  const applyPreset = (next: CodePreset) => {
    setPreset(next);
    writeCodePreset(next);
    // Resize the chat panel; the comux pane fills the remainder (clamped to its
    // own minSize). This goes through onLayoutChanged, so it persists — no
    // remount, so the comux terminals/file preview keep their state.
    chatPanelRef.current?.resize(CODE_PRESET_CHAT_SIZE[next]);
    // A preset is a task setup, not just a width: hide/show the projects list
    // and tell comux which right pane (files vs. git changes) to show.
    setProjectList(CODE_PRESET_HIDES_PROJECT_LIST[next]);
    window.dispatchEvent(new CustomEvent(CODE_PRESET_EVENT, { detail: { preset: next } }));
  };

  const toggleProjects = () => setProjectList(!projectsCollapsed);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-2 py-1">
        <button
          type="button"
          onClick={toggleProjects}
          aria-pressed={!projectsCollapsed}
          aria-label={projectsCollapsed ? "Show projects list" : "Hide projects list"}
          title={projectsCollapsed ? "Show projects list" : "Hide projects list"}
          className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 px-2 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name={projectsCollapsed ? "ph:sidebar-simple" : "ph:sidebar-simple-fill"} width={13} />
          <span>Projects</span>
        </button>
        <div className="flex items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 p-0.5 text-[11px]">
          {CODE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              aria-pressed={preset === p}
              title={CODE_PRESET_HINTS[p]}
              className={`flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 transition-colors ${
                preset === p
                  ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Icon name={CODE_PRESET_ICONS[p]} width={13} />
              {CODE_PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
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

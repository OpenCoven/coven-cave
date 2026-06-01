"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { Icon, type IconName } from "@/lib/icon";

// Shell — multi-pane app chrome. Horizontal Group of nav/list/detail/agent,
// optionally wrapped in a vertical Group when a bottom slot (terminal) is set.
//
// Keyboard:
//   ⌘B   toggle nav
//   ⌘\   toggle list
//   ⌘J   toggle agent
//   ⌃`   toggle bottom terminal

const SHELL_GROUP_ID = "cave.shell.widths.v1";
const BOTTOM_GROUP_ID = "cave.shell.bottom.v1";

const shellStorage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  },
};

function togglePanel(panel: PanelImperativeHandle | null) {
  if (!panel) return;
  if (panel.isCollapsed()) panel.expand();
  else panel.collapse();
}

export type ShellNavSection = {
  label?: string;
  items: ShellNavItem[];
  customContent?: ReactNode;
};

export type ShellNavItem = {
  id: string;
  label: string;
  icon: IconName;
  kbd?: string;
  active?: boolean;
  onClick?: () => void;
  presence?: "active" | "idle";
};

export function Shell({
  nav,
  list,
  detail,
  agent,
  bottom,
  topBar,
}: {
  nav: ReactNode;
  list?: ReactNode;
  detail: ReactNode;
  agent?: ReactNode;
  bottom?: ReactNode;
  topBar?: ReactNode;
}) {
  const navRef = useRef<PanelImperativeHandle | null>(null);
  const listRef = useRef<PanelImperativeHandle | null>(null);
  const agentRef = useRef<PanelImperativeHandle | null>(null);
  const bottomRef = useRef<PanelImperativeHandle | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const twoPane = !list;
  const hasAgent = !!agent;
  const hasBottom = !!bottom;
  const panelIds: string[] = ["nav"];
  if (!twoPane) panelIds.push("list");
  panelIds.push("detail");
  if (hasAgent) panelIds.push("agent");
  const groupId =
    (twoPane ? `${SHELL_GROUP_ID}.two-pane` : SHELL_GROUP_ID) +
    (hasAgent ? ".agent" : "");

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: groupId,
    panelIds,
    storage: shellStorage,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        togglePanel(navRef.current);
      } else if (key === "\\" && !twoPane) {
        e.preventDefault();
        togglePanel(listRef.current);
      } else if (key === "j" && hasAgent) {
        e.preventDefault();
        togglePanel(agentRef.current);
      }
    };
    const bottomToggle = (e: KeyboardEvent) => {
      if (!hasBottom) return;
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        togglePanel(bottomRef.current);
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keydown", bottomToggle);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keydown", bottomToggle);
    };
  }, [twoPane, hasAgent, hasBottom]);

  if (!mounted) {
    return (
      <div className="flex h-screen w-screen flex-col">
        {topBar}
        <div className="shell-root flex-1 min-h-0" />
      </div>
    );
  }

  const horizontalGroup = (
    <Group
      className="shell-root flex-1 min-h-0"
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel
        id="nav"
        className="shell-nav-panel"
        defaultSize="240px"
        minSize="200px"
        maxSize="360px"
        collapsible
        collapsedSize={0}
        panelRef={navRef}
      >
        <aside className="shell-nav">{nav}</aside>
      </Panel>
      <Separator className="shell-separator" />
      {!twoPane && (
        <>
          <Panel
            id="list"
            className="shell-list-panel"
            defaultSize="260px"
            minSize="220px"
            maxSize="480px"
            collapsible
            collapsedSize={0}
            panelRef={listRef}
          >
            <aside className="shell-list">{list}</aside>
          </Panel>
          <Separator className="shell-separator" />
        </>
      )}
      <Panel id="detail" className="shell-detail-panel">
        <main className="shell-detail">{detail}</main>
      </Panel>
      {hasAgent && (
        <>
          <Separator className="shell-separator" />
          <Panel
            id="agent"
            className="shell-agent-panel"
            defaultSize="380px"
            minSize="300px"
            maxSize="560px"
            collapsible
            collapsedSize={0}
            panelRef={agentRef}
          >
            <aside className="shell-agent">{agent}</aside>
          </Panel>
        </>
      )}
    </Group>
  );

  return (
    <div className="flex h-screen w-screen flex-col">
      {topBar}
      {hasBottom ? (
        <Group
          className="flex-1 min-h-0"
          orientation="vertical"
          id={BOTTOM_GROUP_ID}
        >
          <Panel id="main" minSize="40%">
            {horizontalGroup}
          </Panel>
          <Separator className="shell-separator-h" />
          <Panel
            id="bottom"
            className="shell-bottom-panel"
            defaultSize="0"
            minSize="120px"
            maxSize="60%"
            collapsible
            collapsedSize={0}
            panelRef={bottomRef}
          >
            <section className="shell-bottom">{bottom}</section>
          </Panel>
        </Group>
      ) : (
        horizontalGroup
      )}
    </div>
  );
}

export function ShellNav({
  header,
  sections,
}: {
  header?: ReactNode;
  sections: ShellNavSection[];
}) {
  return (
    <>
      {header}
      {sections.map((section, idx) => (
        <div key={section.label ?? `section-${idx}`}>
          {section.label && (
            <div className="shell-nav-eyebrow">{section.label}</div>
          )}
          {section.customContent ?? section.items.map((item) => (
            <ShellNavButton key={item.id} item={item} />
          ))}
        </div>
      ))}
    </>
  );
}

export function ShellNavButton({ item }: { item: ShellNavItem }) {
  return (
    <button
      type="button"
      className={`shell-nav-item${item.active ? " shell-nav-item--active" : ""}`}
      onClick={item.onClick}
    >
      <span className="shell-nav-item-icon">
        <Icon name={item.icon} width={14} />
      </span>
      <span>{item.label}</span>
      {item.presence && (
        <span
          aria-hidden
          className={`shell-presence-dot ml-auto${item.presence === "idle" ? " shell-presence-dot--idle" : ""}`}
        />
      )}
      {item.kbd && !item.presence && (
        <span className="shell-nav-kbd">{item.kbd}</span>
      )}
    </button>
  );
}

export function ShellNavHeader({
  initial,
  label,
}: {
  initial: string;
  label: string;
}) {
  return (
    <button type="button" className="shell-nav-header">
      <span className="shell-nav-avatar">{initial}</span>
      <span>{label}</span>
      <Icon
        name="ph:caret-down"
        width={12}
        className="ml-auto opacity-60"
      />
    </button>
  );
}

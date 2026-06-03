"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import type { ForwardedRef } from "react";
import { forwardRef } from "react";
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
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        // Guard: clear corrupted layouts where detail panel (id="detail") is ≤5%.
        try {
          const parsed = JSON.parse(raw) as Record<string, { layout?: number[] }>;
          for (const entry of Object.values(parsed)) {
            if (!Array.isArray(entry?.layout)) continue;
            // detail is last non-bottom panel; if any panel is suspiciously ≤2%, nuke the layout.
            if (entry.layout.some((v, i) => i > 0 && v <= 2)) {
              window.localStorage.removeItem(key);
              return null;
            }
          }
        } catch { /* not JSON layout, pass through */ }
      }
      return raw;
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

export type ShellHandle = {
  openAgent: () => void;
  closeAgent: () => void;
  toggleAgent: () => void;
};

function ShellInner({
  nav,
  list,
  detail,
  agent,
  agentLabel,
  agentIcon,
  bottom,
  topBar,
}: {
  nav: ReactNode;
  list?: ReactNode;
  detail: ReactNode;
  agent?: ReactNode;
  agentLabel?: string;
  agentIcon?: IconName;
  bottom?: ReactNode;
  topBar?: ReactNode;
}, ref: ForwardedRef<ShellHandle>) {
  const navRef = useRef<PanelImperativeHandle | null>(null);
  const listRef = useRef<PanelImperativeHandle | null>(null);
  const agentRef = useRef<PanelImperativeHandle | null>(null);
  const bottomRef = useRef<PanelImperativeHandle | null>(null);
  const [mounted, setMounted] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  useImperativeHandle(ref, () => ({
    openAgent: () => {
      agentRef.current?.expand();
      setAgentOpen(true);
    },
    closeAgent: () => {
      agentRef.current?.collapse();
      setAgentOpen(false);
    },
    toggleAgent: () => {
      const panel = agentRef.current;
      if (!panel) return;
      if (panel.isCollapsed()) { panel.expand(); setAgentOpen(true); }
      else { panel.collapse(); setAgentOpen(false); }
    },
  }), []);

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
          const panel = agentRef.current;
          if (!panel) return;
          if (panel.isCollapsed()) {
            panel.expand();
            setAgentOpen(true);
          } else {
            panel.collapse();
            setAgentOpen(false);
          }
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
      <div className="flex h-full w-full flex-col">
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
        defaultSize="17%"
        minSize="14%"
        maxSize="25%"
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
            defaultSize="18%"
            minSize="15%"
            maxSize="33%"
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
            defaultSize={"0%"}
            minSize="20%"
            maxSize="38%"
            collapsible
            collapsedSize={0}
            panelRef={agentRef}
            onResize={(size) => setAgentOpen((size.asPercentage ?? 0) > 0)}
          >
            <aside className="shell-agent">{agentOpen ? agent : null}</aside>
          </Panel>
        </>
      )}
    </Group>
  );

  // Right-rail toggle tab (Dia/Linear-style vertical pill)
  const agentTab = hasAgent ? (
    <button
      className="shell-agent-tab"
      aria-label={agentOpen ? `Close ${agentLabel ?? "Browser"}` : `Open ${agentLabel ?? "Browser"}`}
      title={`${agentLabel ?? "Browser"} (⌘J)`}
      onClick={() => {
        const panel = agentRef.current;
        if (!panel) return;
        if (panel.isCollapsed()) {
          panel.expand();
          setAgentOpen(true);
        } else {
          panel.collapse();
          setAgentOpen(false);
        }
      }}
    >
      <Icon name={agentIcon ?? "ph:globe"} width={14} height={14} />
      <span className="shell-agent-tab-label">{agentLabel ?? "Browser"}</span>
      <span style={{ transform: agentOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", display: "flex" }}>
        <Icon name="ph:caret-right" width={10} height={10} className="shell-agent-tab-chevron" />
      </span>
    </button>
  ) : null;

  return (
    <div className="flex h-full w-full flex-col">
      {topBar}
      <div className="flex flex-1 min-h-0 relative">
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
              minSize="8%"
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
        {agentTab}
      </div>
    </div>
  );
}

export const Shell = forwardRef<ShellHandle, Parameters<typeof ShellInner>[0]>(ShellInner);

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

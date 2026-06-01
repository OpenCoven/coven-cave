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

// Shell — the three-pane app chrome introduced by issue #14.
//
// Layout (react-resizable-panels horizontal Group):
//   ┌────────┬─────────────┬──────────────────────────┐
//   │  app   │   context   │                          │
//   │  nav   │   list      │      detail pane         │
//   │ 240px  │  ~260px     │         (flex)           │
//   └────────┴─────────────┴──────────────────────────┘
//
// `list` is optional — pass `list={null}` for a two-pane layout
// (used by full-bleed modes like /mockup-style settings).
//
// Resize: drag separators. Widths persist to localStorage under
//   cave.shell.widths.v1            (three-pane)
//   cave.shell.widths.v1.two-pane   (two-pane)
//
// Collapse:
//   ⌘B  toggles the nav pane
//   ⌘\  toggles the list pane (three-pane only)

const SHELL_GROUP_ID = "cave.shell.widths.v1";

// SSR-safe localStorage wrapper. react-resizable-panels reads storage
// during render via useDefaultLayout, so we cannot rely on a `typeof
// window` guard at the call site alone.
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
  topBar,
}: {
  nav: ReactNode;
  list?: ReactNode;
  detail: ReactNode;
  topBar?: ReactNode;
}) {
  const navRef = useRef<PanelImperativeHandle | null>(null);
  const listRef = useRef<PanelImperativeHandle | null>(null);
  // Persisted widths come from localStorage on client only; render a
  // layout-free placeholder on server + first client paint to keep the
  // hydration tree matching, then mount the real Group.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const twoPane = !list;
  const panelIds = twoPane ? ["nav", "detail"] : ["nav", "list", "detail"];
  const groupId = twoPane ? `${SHELL_GROUP_ID}.two-pane` : SHELL_GROUP_ID;

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
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [twoPane]);

  if (!mounted) {
    return (
      <div className="flex h-screen w-screen flex-col">
        {topBar}
        <div className="shell-root flex-1 min-h-0" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      {topBar}
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
      </Group>
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
          {section.items.map((item) => (
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

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
import { useShellBanners } from "@/lib/shell-banners";

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
  openNav: () => void;
  closeNav: () => void;
  toggleNav: () => void;
};

function ShellInner({
  familiarRail,
  agentRail,
  nav,
  list,
  detail,
  agent,
  bottom,
  topBar,
  onNavOpenChange,
  onAgentOpenChange,
}: {
  familiarRail?: ReactNode;
  /** Mirror of familiarRail on the right edge — typically a thin column with
   *  a toggle for the agent panel. Rendered after the panel group. */
  agentRail?: ReactNode;
  nav: ReactNode;
  list?: ReactNode;
  detail: ReactNode;
  agent?: ReactNode;
  bottom?: ReactNode;
  topBar?: ReactNode;
  onNavOpenChange?: (open: boolean) => void;
  onAgentOpenChange?: (open: boolean) => void;
}, ref: ForwardedRef<ShellHandle>) {
  const navRef = useRef<PanelImperativeHandle | null>(null);
  const listRef = useRef<PanelImperativeHandle | null>(null);
  const agentRef = useRef<PanelImperativeHandle | null>(null);
  const bottomRef = useRef<PanelImperativeHandle | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useImperativeHandle(ref, () => ({
    openAgent: () => { agentRef.current?.expand(); setAgentOpen(true); },
    closeAgent: () => { agentRef.current?.collapse(); setAgentOpen(false); },
    toggleAgent: () => {
      const panel = agentRef.current;
      if (!panel) return;
      if (panel.isCollapsed()) { panel.expand(); setAgentOpen(true); }
      else { panel.collapse(); setAgentOpen(false); }
    },
    openNav: () => { navRef.current?.expand(); setNavOpen(true); },
    closeNav: () => { navRef.current?.collapse(); setNavOpen(false); },
    toggleNav: () => {
      const panel = navRef.current;
      if (!panel) return;
      if (panel.isCollapsed()) { panel.expand(); setNavOpen(true); }
      else { panel.collapse(); setNavOpen(false); }
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

  // Initialise agentOpen from persisted layout so the agent content renders
  // immediately when layout is restored to an expanded state, rather than
  // waiting for the first onResize callback.
  const agentPanelIdx = panelIds.indexOf("agent");
  const [agentOpen, setAgentOpen] = useState(() => {
    if (agentPanelIdx < 0 || !defaultLayout) return false;
    const pct = defaultLayout[agentPanelIdx];
    return typeof pct === "number" && pct > 0;
  });

  const navPanelIdx = panelIds.indexOf("nav");
  const [navOpen, setNavOpen] = useState(() => {
    if (!defaultLayout) return true;
    const pct = defaultLayout[navPanelIdx];
    return typeof pct !== "number" || pct > 0;
  });

  // Track rendered pixel widths of the side panels so child surfaces (e.g. the
  // Home composer) can visually center on the viewport rather than on the
  // asymmetric .shell-detail panel.
  const [navWidthPx, setNavWidthPx] = useState(0);
  const [agentWidthPx, setAgentWidthPx] = useState(0);

  useEffect(() => {
    onNavOpenChange?.(navOpen);
  }, [navOpen, onNavOpenChange]);

  useEffect(() => {
    onAgentOpenChange?.(agentOpen);
  }, [agentOpen, onAgentOpenChange]);

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
      <div className="shell-frame flex h-full w-full flex-col">
        {topBar}
        <div className="shell-body flex flex-1 min-h-0">
          {familiarRail}
          <div className="shell-root flex-1 min-h-0" />
        </div>
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
        onResize={(size) => {
          setNavOpen((size.asPercentage ?? 0) > 0);
          setNavWidthPx(size.inPixels ?? 0);
        }}
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
        <main className="shell-detail">
          <ShellBannerStrip />
          {detail}
        </main>
      </Panel>
      {hasAgent && (
        <>
          <Separator className="shell-separator" />
          <Panel
            id="agent"
            className="shell-agent-panel"
            defaultSize={"0%"}
            minSize="25%"
            maxSize="38%"
            collapsible
            collapsedSize={0}
            panelRef={agentRef}
            onResize={(size) => {
              setAgentOpen((size.asPercentage ?? 0) > 0);
              setAgentWidthPx(size.inPixels ?? 0);
            }}
          >
            <aside className="shell-agent">{agentOpen ? agent : null}</aside>
          </Panel>
        </>
      )}
    </Group>
  );

  return (
    <div
      className="shell-frame flex h-full w-full flex-col"
      style={{
        // Surfaces that need to visually center on the viewport (e.g. Home)
        // use these to compensate for the asymmetric side-panel widths.
        ["--shell-nav-px" as const]: `${Math.round(navWidthPx)}px`,
        ["--shell-agent-px" as const]: `${Math.round(agentWidthPx)}px`,
      }}
    >
      {topBar}
      <div className="shell-body flex flex-1 min-h-0">
        {familiarRail}
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
        {agentRail}
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

function ShellBannerStrip() {
  const { banners, dismissBanner } = useShellBanners();
  if (banners.length === 0) return null;
  return (
    <div className="shell-banner-strip">
      {banners.map((b) => (
        <div
          key={b.id}
          className={`shell-banner shell-banner--${b.severity}`}
          role={b.severity === "error" ? "alert" : "status"}
        >
          <span className="shell-banner__title">{b.title}</span>
          {b.cta ? (
            <button
              type="button"
              className="shell-banner__cta"
              onClick={b.cta.onClick}
            >
              {b.cta.label}
            </button>
          ) : null}
          <button
            type="button"
            className="shell-banner__dismiss"
            aria-label="Dismiss"
            onClick={() => dismissBanner(b.id)}
            title="Dismiss"
          >
            <Icon name="ph:x" width={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

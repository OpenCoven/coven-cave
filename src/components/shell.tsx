"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { UpdateBannerTrigger } from "@/components/update-available";
import { useIsMobile } from "@/lib/use-viewport";
import { MobileDrawer, type MobileDrawerSlot } from "@/components/mobile-drawer";

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
  openList: () => void;
  closeList: () => void;
  toggleList: () => void;
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
  mobileTabs,
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
  /** Mobile/tablet-only bottom tab bar. Rendered after `.shell-body`
   *  inside `.shell-frame`, but only when the viewport matches the
   *  mobile breakpoint (≤1023px). */
  mobileTabs?: ReactNode;
  onNavOpenChange?: (open: boolean) => void;
  onAgentOpenChange?: (open: boolean) => void;
}, ref: ForwardedRef<ShellHandle>) {
  const navRef = useRef<PanelImperativeHandle | null>(null);
  const listRef = useRef<PanelImperativeHandle | null>(null);
  const agentRef = useRef<PanelImperativeHandle | null>(null);
  const bottomRef = useRef<PanelImperativeHandle | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Mobile drawer: which of the nav/list/agent panels is currently slid in
  // as a full-height overlay. On desktop this stays null and react-resizable-
  // panels owns the layout. On phones the panels stay mounted but we override
  // their position to fixed via CSS (see globals.css, @media max-width 767px);
  // this state drives the `[data-mobile-drawer]` attribute that triggers the
  // slide. We deliberately do NOT call panel.collapse/expand on mobile —
  // that would write to the persisted desktop layout for no benefit.
  const isMobile = useIsMobile();
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawerSlot>(null);

  // When the viewport crosses back to desktop, drop any open drawer state so
  // we don't end up with a stale [data-mobile-drawer] attribute applying to
  // a layout that's no longer in mobile mode.
  useEffect(() => {
    if (!isMobile) setMobileDrawer(null);
  }, [isMobile]);

  useImperativeHandle(ref, () => {
    const toggleDrawer = (slot: NonNullable<MobileDrawerSlot>) => {
      setMobileDrawer((curr) => (curr === slot ? null : slot));
    };
    return {
      openAgent: () => {
        if (isMobile) { setMobileDrawer("agent"); return; }
        agentRef.current?.expand();
        setAgentOpen(true);
      },
      closeAgent: () => {
        if (isMobile) { setMobileDrawer((c) => (c === "agent" ? null : c)); return; }
        agentRef.current?.collapse();
        setAgentOpen(false);
      },
      toggleAgent: () => {
        if (isMobile) { toggleDrawer("agent"); return; }
        const panel = agentRef.current;
        if (!panel) return;
        if (panel.isCollapsed()) { panel.expand(); setAgentOpen(true); }
        else { panel.collapse(); setAgentOpen(false); }
      },
      openNav: () => {
        if (isMobile) { setMobileDrawer("nav"); return; }
        navRef.current?.expand();
        setNavOpen(true);
      },
      closeNav: () => {
        if (isMobile) { setMobileDrawer((c) => (c === "nav" ? null : c)); return; }
        navRef.current?.collapse();
        setNavOpen(false);
      },
      toggleNav: () => {
        if (isMobile) { toggleDrawer("nav"); return; }
        const panel = navRef.current;
        if (!panel) return;
        if (panel.isCollapsed()) { panel.expand(); setNavOpen(true); }
        else { panel.collapse(); setNavOpen(false); }
      },
      openList: () => {
        if (isMobile) { setMobileDrawer("list"); return; }
        listRef.current?.expand();
      },
      closeList: () => {
        if (isMobile) { setMobileDrawer((c) => (c === "list" ? null : c)); return; }
        listRef.current?.collapse();
      },
      toggleList: () => {
        if (isMobile) { toggleDrawer("list"); return; }
        togglePanel(listRef.current);
      },
    };
  }, [isMobile]);

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

  // Track the detail panel's REAL left/right viewport gaps (side panels +
  // separators + edge rails — everything between the detail box and the
  // viewport edges) so child surfaces (e.g. the Home composer) can visually
  // center on the viewport rather than on the asymmetric .shell-detail panel.
  //
  // Measured from the detail element's own rect instead of the panel
  // onResize callbacks, for two reasons (both were shipped bugs):
  //   1. onResize lands AFTER first paint, so the home content painted
  //      ~nav/2 off-center at startup and then slid into place. The
  //      useLayoutEffect below runs in the same commit that mounts the
  //      panels, so the first painted frame already has correct gaps.
  //   2. Panel widths miss the separators and the agent-trigger rail,
  //      leaving a permanent ~11px centering bias.
  const detailElRef = useRef<HTMLElement | null>(null);
  const [detailGaps, setDetailGaps] = useState({ left: 0, right: 0 });

  useLayoutEffect(() => {
    if (!mounted) return;
    const el = detailElRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const left = Math.max(0, Math.round(rect.left));
      const right = Math.max(0, Math.round(window.innerWidth - rect.right));
      setDetailGaps((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    measure();
    // Separator drags and panel collapse/expand resize the detail element;
    // window resizes that somehow don't (e.g. only chrome around the group
    // changes) are caught by the window listener.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mounted, hasBottom, hasAgent, twoPane, isMobile]);

  // The first painted frames can still shift: react-resizable-panels applies
  // its persisted layout (and Workspace collapses an empty companion rail)
  // one frame AFTER first paint, so the gap correction above lands a frame
  // late. Keep centering transitions OFF during that startup window so the
  // correction snaps invisibly instead of gliding 120ms across the screen;
  // flip them on once startup has settled (user-initiated toggles still
  // animate). 250ms is several frames past the observed 1–2 frame settle.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!mounted) return;
    const t = window.setTimeout(() => setSettled(true), 250);
    return () => window.clearTimeout(t);
  }, [mounted]);

  useEffect(() => {
    onNavOpenChange?.(navOpen);
  }, [navOpen, onNavOpenChange]);

  useEffect(() => {
    onAgentOpenChange?.(agentOpen);
  }, [agentOpen, onAgentOpenChange]);

  useEffect(() => {
    const toggleDrawerSlot = (slot: NonNullable<MobileDrawerSlot>) => {
      setMobileDrawer((curr) => (curr === slot ? null : slot));
    };
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        if (isMobile) toggleDrawerSlot("nav");
        else togglePanel(navRef.current);
      } else if (key === "\\" && !twoPane) {
        e.preventDefault();
        if (isMobile) toggleDrawerSlot("list");
        else togglePanel(listRef.current);
      } else if (key === "j" && hasAgent) {
        e.preventDefault();
        if (isMobile) {
          toggleDrawerSlot("agent");
        } else {
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
      }
    };
    const bottomToggle = (e: KeyboardEvent) => {
      if (!hasBottom) return;
      // Bottom terminal is desktop-only (Tauri-gated); no mobile drawer.
      if (isMobile) return;
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
  }, [twoPane, hasAgent, hasBottom, isMobile]);

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
      data-mobile-drawer={isMobile && mobileDrawer ? mobileDrawer : undefined}
    >
      <Panel
        id="nav"
        className={`shell-nav-panel${navOpen ? " shell-nav-panel--open" : ""}`}
        defaultSize="18%"
        minSize="14%"
        maxSize="25%"
        collapsible
        collapsedSize={0}
        panelRef={navRef}
        onResize={(size) => {
          setNavOpen((size.asPercentage ?? 0) > 0);
        }}
      >
        {/* CHAT-D13-05: every complementary landmark carries a distinct
            accessible name (axe landmark-unique). */}
        <aside className="shell-nav" aria-label="Sidebar">{nav}</aside>
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
            <aside className="shell-list" aria-label="List pane">{list}</aside>
          </Panel>
          <Separator className="shell-separator" />
        </>
      )}
      <Panel id="detail" className="shell-detail-panel">
        <main className="shell-detail" ref={detailElRef}>
          <UpdateBannerTrigger />
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
            defaultSize={"18%"}
            minSize="14%"
            maxSize="50%"
            collapsible
            collapsedSize={0}
            panelRef={agentRef}
            onResize={(size) => {
              setAgentOpen((size.asPercentage ?? 0) > 0);
            }}
          >
            <aside className="shell-agent" aria-label="Companion">{agentOpen ? agent : null}</aside>
          </Panel>
        </>
      )}
    </Group>
  );

  const homeCenteringActive = navOpen && agentOpen;
  const homeCenterShift = homeCenteringActive
    ? Math.round((detailGaps.right - detailGaps.left) / 2)
    : 0;

  const shellFrameStyle: CSSProperties & {
    "--shell-left-gap-px": string;
    "--shell-right-gap-px": string;
    "--shell-home-center-shift-px": string;
  } = {
    // The detail panel's real left/right viewport gaps (side panels +
    // separators + edge rails). Surfaces can read these to reason about the
    // chrome around the detail panel; Home now simply fills the detail panel
    // rather than translating toward the viewport center.
    "--shell-left-gap-px": `${detailGaps.left}px`,
    "--shell-right-gap-px": `${detailGaps.right}px`,
    "--shell-home-center-shift-px": `${homeCenterShift}px`,
  };

  // Floating reopen affordance — once the sidebar is collapsed (via its own
  // top toggle, ⌘B, or a drag), this left-edge rail is how it comes back. It
  // stays hidden while the nav is open so the in-panel toggle owns collapsing.
  const navRail =
    !isMobile && !navOpen ? (
      <aside className="agent-trigger-rail agent-trigger-rail--left" aria-label="Navigation toggle">
        <button
          type="button"
          className="agent-trigger-rail__toggle"
          aria-label={navOpen ? "Hide navigation" : "Show navigation"}
          aria-expanded={navOpen}
          title={navOpen ? "Hide navigation (⌘B)" : "Show navigation (⌘B)"}
          onClick={() => {
            if (navOpen) {
              navRef.current?.collapse();
              setNavOpen(false);
            } else {
              navRef.current?.expand();
              setNavOpen(true);
            }
          }}
        >
          <span className="edge-rail-chip">
            <Icon name={navOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={14} />
          </span>
        </button>
      </aside>
    ) : null;

  return (
    <div
      className="shell-frame flex h-full w-full flex-col"
      style={shellFrameStyle}
      data-settled={settled ? "" : undefined}
    >
      {topBar}
      <div className="shell-body flex flex-1 min-h-0">
        {familiarRail}
        {navRail}
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
      {isMobile && mobileTabs ? mobileTabs : null}
      <MobileDrawer
        open={isMobile ? mobileDrawer : null}
        onClose={() => setMobileDrawer(null)}
      />
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
            onClick={() => { b.onDismiss?.(); dismissBanner(b.id); }}
            title="Dismiss"
          >
            <Icon name="ph:x" width={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

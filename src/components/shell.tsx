"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import {
  getPanelShortcutBindings,
  labelPanelShortcut,
  matchesPanelShortcut,
  type PanelShortcutBindings,
} from "@/lib/panel-shortcuts";

// Shell — multi-pane app chrome. Horizontal Group of nav/list/detail/agent,
// optionally wrapped in a vertical Group when a bottom slot (terminal) is set.
//
// Keyboard:
//   ⌘B   toggle nav
//   ⌘\   toggle list
//   ⌘⇧B  toggle agent
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
  openFamiliar: () => void;
  closeFamiliar: () => void;
  toggleFamiliar: () => void;
  openNav: () => void;
  closeNav: () => void;
  toggleNav: () => void;
  openList: () => void;
  closeList: () => void;
  toggleList: () => void;
  /** Dismiss the nav/list ONLY on mobile (where it's an overlay drawer over the
   *  content). On desktop these are persistent side panels, so selecting an
   *  option inside them must NOT collapse them — these are no-ops there. */
  dismissNavMobile: () => void;
  dismissListMobile: () => void;
};

type ShellMobileChromeState = {
  navDrawerOpen: boolean;
  listDrawerOpen: boolean;
  familiarDrawerOpen: boolean;
};

type ShellTopBar = ReactNode | ((state: ShellMobileChromeState) => ReactNode);

function ShellInner({
  nav,
  list,
  detail,
  agent,
  bottom,
  topBar,
  mobileTabs,
  onNavOpenChange,
  onFamiliarOpenChange,
  panelShortcutOverrides,
}: {
  nav: ReactNode;
  list?: ReactNode;
  detail: ReactNode;
  agent?: ReactNode;
  bottom?: ReactNode;
  topBar?: ShellTopBar;
  /** Mobile/tablet-only bottom tab bar. Rendered after `.shell-body`
   *  inside `.shell-frame`, but only when the viewport matches the
   *  mobile breakpoint (≤1023px). */
  mobileTabs?: ReactNode;
  onNavOpenChange?: (open: boolean) => void;
  onFamiliarOpenChange?: (open: boolean) => void;
  panelShortcutOverrides?: Partial<PanelShortcutBindings>;
}, ref: ForwardedRef<ShellHandle>) {
  const navRef = useRef<PanelImperativeHandle | null>(null);
  const listRef = useRef<PanelImperativeHandle | null>(null);
  const familiarRef = useRef<PanelImperativeHandle | null>(null);
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
  const mobileChromeState: ShellMobileChromeState = {
    navDrawerOpen: isMobile && mobileDrawer === "nav",
    listDrawerOpen: isMobile && mobileDrawer === "list",
    familiarDrawerOpen: isMobile && mobileDrawer === "agent",
  };
  const renderedTopBar = typeof topBar === "function" ? topBar(mobileChromeState) : topBar;
  const panelShortcuts = useMemo(
    () => getPanelShortcutBindings(panelShortcutOverrides),
    [panelShortcutOverrides],
  );
  const leftPanelShortcutLabel = labelPanelShortcut(panelShortcuts.toggleLeftPanel);

  useImperativeHandle(ref, () => {
    const toggleDrawer = (slot: NonNullable<MobileDrawerSlot>) => {
      setMobileDrawer((curr) => (curr === slot ? null : slot));
    };
    return {
      openFamiliar: () => {
        if (isMobile) { setMobileDrawer("agent"); return; }
        familiarRef.current?.expand();
        setFamiliarOpen(true);
      },
      closeFamiliar: () => {
        if (isMobile) { setMobileDrawer((c) => (c === "agent" ? null : c)); return; }
        familiarRef.current?.collapse();
        setFamiliarOpen(false);
      },
      toggleFamiliar: () => {
        if (isMobile) { toggleDrawer("agent"); return; }
        const panel = familiarRef.current;
        if (!panel) return;
        if (panel.isCollapsed()) { panel.expand(); setFamiliarOpen(true); }
        else { panel.collapse(); setFamiliarOpen(false); }
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
      dismissNavMobile: () => {
        if (isMobile) setMobileDrawer((c) => (c === "nav" ? null : c));
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
      dismissListMobile: () => {
        if (isMobile) setMobileDrawer((c) => (c === "list" ? null : c));
      },
      toggleList: () => {
        if (isMobile) { toggleDrawer("list"); return; }
        togglePanel(listRef.current);
      },
    };
  }, [isMobile]);

  const twoPane = !list;
  const hasFamiliar = !!agent;
  const hasBottom = !!bottom;
  const panelIds: string[] = ["nav"];
  if (!twoPane) panelIds.push("list");
  panelIds.push("detail");
  if (hasFamiliar) panelIds.push("agent");
  const groupId =
    (twoPane ? `${SHELL_GROUP_ID}.two-pane` : SHELL_GROUP_ID) +
    (hasFamiliar ? ".agent" : "");

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: groupId,
    panelIds,
    storage: shellStorage,
  });

  // Initialise familiarOpen from persisted layout so the agent content renders
  // immediately when layout is restored to an expanded state, rather than
  // waiting for the first onResize callback.
  const familiarPanelIdx = panelIds.indexOf("agent");
  const [familiarOpen, setFamiliarOpen] = useState(() => {
    if (familiarPanelIdx < 0 || !defaultLayout) return false;
    const pct = defaultLayout[familiarPanelIdx];
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
  //   2. Panel widths miss the separators and the familiar-trigger rail,
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
  }, [mounted, hasBottom, hasFamiliar, twoPane, isMobile]);

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

  // Proximity glow: as the cursor moves toward a floating panel toggle, fade in
  // (and pulse) its chip. Each float gets a `--float-prox` (0→1) driven by the
  // cursor's distance to the chip; the CSS uses it for opacity + the pulse.
  useEffect(() => {
    if (!mounted || isMobile) return;
    const RANGE = 250; // px — how far out the glow starts responding
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const floatTop =
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--shell-float-top"),
          ) || 50;
        for (const el of document.querySelectorAll<HTMLElement>(".shell-panel-float")) {
          const r = el.getBoundingClientRect();
          // Chip center: corner tabs are pinned at 35px; the expand toggle keeps
          // the measured header position.
          const isLeftCorner = el.classList.contains("shell-panel-float--left");
          const isRightCorner = el.classList.contains("shell-panel-float--right");
          const cx = isLeftCorner ? r.left + 17.5 : isRightCorner ? r.right - 17.5 : r.left + r.width / 2;
          const cy = isLeftCorner || isRightCorner ? r.top + 17.5 : r.top + floatTop + 14;
          const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
          const prox = Math.max(0, Math.min(1, 1 - dist / RANGE));
          el.style.setProperty("--float-prox", prox.toFixed(3));
        }
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [mounted, isMobile]);

  useEffect(() => {
    onNavOpenChange?.(navOpen);
  }, [navOpen, onNavOpenChange]);

  useEffect(() => {
    onFamiliarOpenChange?.(familiarOpen);
  }, [familiarOpen, onFamiliarOpenChange]);

  useEffect(() => {
    const toggleDrawerSlot = (slot: NonNullable<MobileDrawerSlot>) => {
      setMobileDrawer((curr) => (curr === slot ? null : slot));
    };
    const toggleFamiliarPanel = () => {
      if (isMobile) {
        toggleDrawerSlot("agent");
        return;
      }
      const panel = familiarRef.current;
      if (!panel) return;
      if (panel.isCollapsed()) {
        panel.expand();
        setFamiliarOpen(true);
      } else {
        panel.collapse();
        setFamiliarOpen(false);
      }
    };
    const handler = (e: KeyboardEvent) => {
      if (matchesPanelShortcut(e, panelShortcuts.toggleLeftPanel)) {
        e.preventDefault();
        if (isMobile) toggleDrawerSlot("nav");
        else togglePanel(navRef.current);
        return;
      }
      const key = e.key.toLowerCase();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && key === "\\" && !twoPane) {
        e.preventDefault();
        if (isMobile) toggleDrawerSlot("list");
        else togglePanel(listRef.current);
      } else if (matchesPanelShortcut(e, panelShortcuts.toggleRightPanel) && hasFamiliar) {
        e.preventDefault();
        toggleFamiliarPanel();
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
  }, [twoPane, hasFamiliar, hasBottom, isMobile, panelShortcuts]);

  if (!mounted) {
    return (
      <div className="shell-frame flex h-full w-full flex-col">
        {renderedTopBar}
        <div className="shell-body flex flex-1 min-h-0">
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
      {hasFamiliar && (
        <>
          <Separator className="shell-separator" />
          <Panel
            id="agent"
            className="shell-familiar-panel"
            defaultSize={"18%"}
            minSize="14%"
            maxSize="50%"
            collapsible
            collapsedSize={0}
            panelRef={familiarRef}
            onResize={(size) => {
              setFamiliarOpen((size.asPercentage ?? 0) > 0);
            }}
          >
            <aside className="shell-familiar" aria-label="Companion">{familiarOpen ? agent : null}</aside>
          </Panel>
        </>
      )}
    </Group>
  );

  const homeCenteringActive = navOpen && familiarOpen;
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
  // Codex-style floating panel toggles. Two always-visible rounded buttons
  // pinned to the shell's top corners that show/hide the side panels: the
  // left one toggles the navigation sidebar, the right one toggles whichever
  // right panel is active (the companion/inspector/browser slot). They replace
  // the old collapsed-only edge rails and the in-panel collapse toggles, so a
  // single persistent control owns each panel regardless of its open state.
  const rightPanelShortcutLabel = labelPanelShortcut(panelShortcuts.toggleRightPanel);
  const toggleNavPanel = () => {
    const panel = navRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) { panel.expand(); setNavOpen(true); }
    else { panel.collapse(); setNavOpen(false); }
  };
  const toggleRightPanel = () => {
    const panel = familiarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) { panel.expand(); setFamiliarOpen(true); }
    else { panel.collapse(); setFamiliarOpen(false); }
  };
  const panelFloats = !isMobile ? (
    <>
      <button
        type="button"
        className={`shell-panel-float shell-panel-float--left focus-ring${navOpen ? " shell-panel-float--active" : ""}`}
        aria-label={navOpen ? "Hide navigation" : "Show navigation"}
        aria-expanded={navOpen}
        title={navOpen ? `Hide navigation (${leftPanelShortcutLabel})` : `Show navigation (${leftPanelShortcutLabel})`}
        onClick={toggleNavPanel}
      >
        <Icon name={navOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={15} />
      </button>
      {hasFamiliar ? (
        <>
          {/* Expand-to-cover toggle, pinned just left of the side-panel trigger.
              CSS keeps it hidden until a chat right panel is actually open
              (:root[data-right-panel-open]) and re-hides it while expanded. It
              reaches the chat surface's expand state via a window event. */}
          <button
            type="button"
            className="shell-panel-float shell-panel-float--expand focus-ring"
            aria-label="Expand side panel"
            title="Expand side panel"
            onClick={() => window.dispatchEvent(new CustomEvent("cave:right-panel-expand"))}
          >
            <Icon name="ph:arrows-out-simple" width={14} />
          </button>
          <button
            type="button"
            className={`shell-panel-float shell-panel-float--right focus-ring${familiarOpen ? " shell-panel-float--active" : ""}`}
            aria-label={familiarOpen ? "Hide side panel" : "Show side panel"}
            aria-expanded={familiarOpen}
            title={familiarOpen ? `Hide side panel (${rightPanelShortcutLabel})` : `Show side panel (${rightPanelShortcutLabel})`}
            onClick={toggleRightPanel}
          >
            <Icon name={familiarOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={15} />
          </button>
        </>
      ) : null}
    </>
  ) : null;

  return (
    <div
      className="shell-frame flex h-full w-full flex-col"
      style={shellFrameStyle}
      data-settled={settled ? "" : undefined}
    >
      {renderedTopBar}
      <div className="shell-body shell-body--floats flex flex-1 min-h-0">
        {panelFloats}
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

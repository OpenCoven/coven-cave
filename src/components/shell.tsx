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
import { Icon, CAVE_ICON_SIZE, type IconName } from "@/lib/icon";
import { useShellBanners } from "@/lib/shell-banners";
import { UpdateBannerTrigger } from "@/components/update-available";
import { OpenCovenToolsBannerTrigger } from "@/components/open-coven-tools-update";
import { useIsMobile } from "@/lib/use-viewport";
import { MobileDrawer, type MobileDrawerSlot } from "@/components/mobile-drawer";
import { DetailSplitHost, type DetailSplitTile } from "@/components/detail-split-host";
import {
  getPanelShortcutBindings,
  labelPanelShortcut,
  matchesPanelShortcut,
  type PanelShortcutBindings,
} from "@/lib/panel-shortcuts";

// Shell — multi-pane app chrome. Horizontal Group of nav/list/detail,
// optionally wrapped in a vertical Group when a bottom slot (terminal) is set.
//
// Keyboard:
//   ⌘B   toggle nav
//   ⌘\   toggle list
//   ⌃`   toggle bottom terminal

// v2: panels went percent → pixel (see shell-left-panels-fit.test.ts); v1
// layouts hold percent widths chosen under the old monitor-scaled defaults.
const SHELL_GROUP_ID = "cave.shell.widths.v2";
const BOTTOM_GROUP_ID = "cave.shell.bottom.v1";

const shellStorage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        // Guard against corrupt/stale saved layouts that would leave dead space
        // in the detail area. react-resizable-panels v4 persists each group as a
        // flat `{ "<panelId>": <percent>, … }` map (e.g. {"nav":26.5,"detail":73.5}).
        // Drop the layout — falling back to the default — when a panel is
        // collapsed to ~0 or the panels don't sum to ~100% (a leftover layout
        // from an old panel set under-fills the group and never re-expands).
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const values = Object.values(parsed as Record<string, unknown>).filter(
              (v): v is number => typeof v === "number" && Number.isFinite(v),
            );
            if (values.length >= 2) {
              const sum = values.reduce((a, b) => a + b, 0);
              const anyCollapsed = values.some((v) => v > 0 && v <= 2);
              if (anyCollapsed || sum < 98 || sum > 102) {
                window.localStorage.removeItem(key);
                return null;
              }
            }
          }
        } catch { /* not a layout object, pass through */ }
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

// The left nav collapses to an icons-only rail (instead of vanishing) so the
// destination icons stay reachable. Sizes at/below the rail read as "collapsed".
const NAV_RAIL_PX = 56;
const NAV_OPEN_THRESHOLD_PX = NAV_RAIL_PX + 16;

export type ShellHandle = {
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
};

type ShellTopBar = ReactNode | ((state: ShellMobileChromeState) => ReactNode);

function ShellInner({
  nav,
  list,
  detail,
  bottom,
  topBar,
  mobileTabs,
  splitTiles = [],
  splitSide = "right",
  onCloseSplit,
  onCloseSplitTile,
  onPromoteSplitTile,
  onDropSplitPage,
  onNavOpenChange,
  panelShortcutOverrides,
}: {
  nav: ReactNode;
  list?: ReactNode;
  detail: ReactNode;
  bottom?: ReactNode;
  topBar?: ShellTopBar;
  /** Secondary pages rendered beside the detail surface, capped by Workspace. */
  splitTiles?: DetailSplitTile[];
  splitSide?: "left" | "right";
  onCloseSplit?: () => void;
  onCloseSplitTile?: (id: string) => void;
  onPromoteSplitTile?: (id: string) => void;
  onDropSplitPage?: (mode: string, side: "left" | "right") => void;
  /** Mobile/tablet-only bottom tab bar. Rendered after `.shell-body`
   *  inside `.shell-frame`, but only when the viewport matches the
   *  mobile breakpoint (≤1023px). */
  mobileTabs?: ReactNode;
  onNavOpenChange?: (open: boolean) => void;
  panelShortcutOverrides?: Partial<PanelShortcutBindings>;
}, ref: ForwardedRef<ShellHandle>) {
  const navRef = useRef<PanelImperativeHandle | null>(null);
  const listRef = useRef<PanelImperativeHandle | null>(null);
  const bottomRef = useRef<PanelImperativeHandle | null>(null);
  // Code-rail ↔ nav coupling bookkeeping (desktop only). When the code rail
  // opens we soft-collapse the nav to its icon rail and remember that WE did it
  // (railAutoCollapsedNavRef); on rail close we restore it — unless the user
  // re-expanded the nav in the meantime (userOverrodeNavRef), in which case
  // their intent wins and we leave the nav alone.
  const railAutoCollapsedNavRef = useRef(false);
  const userOverrodeNavRef = useRef(false);
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

  // Seamless macOS title bar: only the macOS desktop Tauri shell overlays the
  // native title bar (lib.rs sets TitleBarStyle::Overlay), so only there do we
  // mark <html> to reserve room for the traffic lights (see
  // [data-tauri-titlebar] in globals.css). Browser, Windows, Linux, and
  // Tauri-mobile keep their normal chrome.
  //
  // The drag itself is handled by Tauri's injected drag.js via the
  // `data-tauri-drag-region="deep"` attributes on the titlebar below: a press
  // on empty chrome anywhere in the subtree invokes
  // `plugin:window|start_dragging`, while clickable elements (buttons, inputs,
  // links, focusable widgets) block the drag so controls keep working.
  // Double-click gets platform-correct zoom/maximize the same way
  // (`internal_toggle_maximize`; on macOS it fires on mouseup and cancels if
  // the cursor moved). Both commands are IPC calls gated by the capability
  // ACL — the webview loads from an external `http://127.0.0.1` URL (a REMOTE
  // execution context to the ACL), so they only work because
  // capabilities/loopback-window-drag.json grants them to the loopback
  // origin. Without that grant every drag path dies silently, and the CSS
  // `-webkit-app-region: drag` hint is equally INERT on external URLs (WebKit
  // only bridges it into a real NSWindow drag on the native `tauri://`
  // scheme) — which is why the titlebar historically never dragged. The CSS
  // stays as a progressive-enhancement fallback for any bundled-scheme build.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTauri = "__TAURI_INTERNALS__" in window;
    // navigator.platform is deprecated and empty on newer WebKit, which made
    // isMac fall through to false and skip the titlebar mode entirely. Prefer
    // the modern userAgentData.platform, then fall back to the UA string.
    const platform =
      (navigator as unknown as { userAgentData?: { platform?: string } })
        .userAgentData?.platform ||
      navigator.userAgent ||
      navigator.platform ||
      "";
    const isMac = /Mac/i.test(platform);
    if (!isTauri || !isMac) return;
    const root = document.documentElement;
    root.dataset.tauriTitlebar = "";
    return () => {
      delete root.dataset.tauriTitlebar;
    };
  }, []);
  const mobileChromeState: ShellMobileChromeState = {
    navDrawerOpen: isMobile && mobileDrawer === "nav",
    listDrawerOpen: isMobile && mobileDrawer === "list",
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
  const hasBottom = !!bottom;
  const panelIds: string[] = ["nav"];
  if (!twoPane) panelIds.push("list");
  panelIds.push("detail");
  const groupId = twoPane ? `${SHELL_GROUP_ID}.two-pane` : SHELL_GROUP_ID;

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: groupId,
    panelIds,
    storage: shellStorage,
  });

  const navPanelIdx = panelIds.indexOf("nav");
  const [navOpen, setNavOpen] = useState(() => {
    if (!defaultLayout) return true;
    const pct = defaultLayout[navPanelIdx];
    return typeof pct !== "number" || pct > 0;
  });

  // Hover-to-peek: when the desktop nav is collapsed to its icon rail, hovering
  // floats it open as an overlay (navPeeking) without changing the collapse
  // state. Reset whenever the rail goes away (expanded or mobile).
  const [navPeeking, setNavPeeking] = useState(false);
  useEffect(() => {
    if (navOpen || isMobile) setNavPeeking(false);
  }, [navOpen, isMobile]);

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
  }, [mounted, hasBottom, twoPane, isMobile]);

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
    const toggleDrawerSlot = (slot: NonNullable<MobileDrawerSlot>) => {
      setMobileDrawer((curr) => (curr === slot ? null : slot));
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
    // Symmetric hook for the left nav panel — lets a collapsed-rail label (e.g.
    // the Code sidebar's "Sessions" rail) reopen the panel without a panel ref.
    const onToggleLeft = () => {
      if (isMobile) toggleDrawerSlot("nav");
      else togglePanel(navRef.current);
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keydown", bottomToggle);
    window.addEventListener("cave:toggle-left-panel", onToggleLeft);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keydown", bottomToggle);
      window.removeEventListener("cave:toggle-left-panel", onToggleLeft);
    };
  }, [twoPane, hasBottom, isMobile, panelShortcuts]);

  // Couple the left nav to the code rail (desktop only — mobile nav is a
  // drawer, so this must never touch it). When the rail opens we soft-collapse
  // the nav to its icon rail so chat stays centered; when it closes we restore
  // the nav UNLESS the user re-expanded it while the rail was open.
  useEffect(() => {
    const onRailVisibility = (e: Event) => {
      const open = (e as CustomEvent<{ open?: boolean }>).detail?.open ?? false;
      if (isMobile) return;
      if (open) {
        // Rail became visible: collapse the nav only if it's currently open,
        // and remember we did it so we can restore later.
        if (navOpen) {
          navRef.current?.collapse();
          railAutoCollapsedNavRef.current = true;
          userOverrodeNavRef.current = false;
        }
        return;
      }
      // Rail hidden: restore the nav if we auto-collapsed it and the user
      // didn't override in the meantime. Clear the auto-collapsed flag BEFORE
      // expanding so the resulting navOpen→true transition isn't misread as a
      // user override (which would wrongly suppress future restores).
      const shouldRestore =
        railAutoCollapsedNavRef.current && !userOverrodeNavRef.current && !isMobile;
      railAutoCollapsedNavRef.current = false;
      userOverrodeNavRef.current = false;
      if (shouldRestore) navRef.current?.expand();
    };
    window.addEventListener("cave:code-rail-visibility", onRailVisibility);
    return () => window.removeEventListener("cave:code-rail-visibility", onRailVisibility);
  }, [isMobile, navOpen]);

  // User-override detection: if the nav becomes open WHILE the rail had
  // auto-collapsed it, that's the user deliberately re-expanding (via the
  // reopen button, ⌘-shortcut, or a drag). Record it so the later rail-close
  // restore is suppressed and we don't fight the user. Programmatic collapse
  // sets navOpen→false (not true) so it never trips this; the programmatic
  // restore-expand clears railAutoCollapsedNavRef first (above) so it doesn't
  // either.
  useEffect(() => {
    if (navOpen && railAutoCollapsedNavRef.current) {
      userOverrodeNavRef.current = true;
    }
  }, [navOpen]);

  // Clear coupling bookkeeping when the viewport crosses into mobile: the nav
  // becomes a drawer and the rail-close handler early-returns on mobile, so a
  // mid-interaction desktop→mobile flip would otherwise strand
  // railAutoCollapsedNavRef=true and cause a spurious nav expand on a later
  // desktop session.
  useEffect(() => {
    if (isMobile) {
      railAutoCollapsedNavRef.current = false;
      userOverrodeNavRef.current = false;
    }
  }, [isMobile]);

  if (!mounted) {
    return (
      <div className="shell-frame flex h-full w-full flex-col">
        <div className="shell-top" data-tauri-drag-region="deep">
          <div className="shell-titlebar-drag-lane" data-tauri-drag-region="deep" aria-hidden="true" />
          <div className="shell-top__bar" data-tauri-drag-region="deep">{renderedTopBar}</div>
        </div>
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
        defaultSize="240px"
        minSize="200px"
        maxSize="420px"
        collapsible
        // Desktop collapses to an icons-only rail; mobile uses the slide-in
        // drawer (position is CSS-overridden there), so it still collapses to 0.
        collapsedSize={isMobile ? 0 : NAV_RAIL_PX}
        panelRef={navRef}
        onResize={(size) => {
          setNavOpen((size.inPixels ?? 0) > NAV_OPEN_THRESHOLD_PX);
        }}
      >
        {/* CHAT-D13-05: every complementary landmark carries a distinct
            accessible name (axe landmark-unique). */}
        <aside
          className={`shell-nav${!isMobile && !navOpen ? (navPeeking ? " shell-nav--peek" : " shell-nav--rail") : ""}`}
          aria-label="Sidebar"
          onMouseEnter={!isMobile && !navOpen ? () => setNavPeeking(true) : undefined}
          onMouseLeave={!isMobile && !navOpen ? () => setNavPeeking(false) : undefined}
        >
          {nav}
        </aside>
      </Panel>
      <Separator className="shell-separator" />
      {!twoPane && (
        <>
          <Panel
            id="list"
            className="shell-list-panel"
            defaultSize="260px"
            minSize="220px"
            maxSize="420px"
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
        <main className="shell-detail" id="shell-main-content" tabIndex={-1} ref={detailElRef}>
          <UpdateBannerTrigger />
          <OpenCovenToolsBannerTrigger />
          <ShellBannerStrip />
          <DetailSplitHost
            primary={detail}
            secondaryTiles={splitTiles}
            secondarySide={splitSide}
            onClose={() => onCloseSplit?.()}
            onCloseTile={(id) => onCloseSplitTile?.(id)}
            onPromoteTile={(id) => onPromoteSplitTile?.(id)}
            onDropPage={(mode, side) => onDropSplitPage?.(mode, side)}
            enableDrop={!isMobile}
          />
        </main>
      </Panel>
    </Group>
  );

  // The right companion panel was removed, so the detail fills to the viewport
  // edge — there is no longer an asymmetric right panel to re-center Home around.
  const homeCenterShift = 0;

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
  // Nav toggle, hoisted into the top menu bar. It anchors the bar's left edge so
  // a single persistent control owns the nav panel regardless of its open state.
  // Desktop-only — below 1024px the mobile `.top-bar` carries its own toggle.
  const toggleNavPanel = () => {
    const panel = navRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) { panel.expand(); setNavOpen(true); }
    else { panel.collapse(); setNavOpen(false); }
  };
  const navToggle = !isMobile ? (
    <button
      type="button"
      className={`shell-top-toggle shell-top-toggle--nav focus-ring${navOpen ? " shell-top-toggle--active" : ""}`}
      aria-label={navOpen ? "Collapse navigation to icons" : "Expand navigation"}
      aria-expanded={navOpen}
      title={navOpen ? `Collapse navigation (${leftPanelShortcutLabel})` : `Expand navigation (${leftPanelShortcutLabel})`}
      onClick={toggleNavPanel}
    >
      <Icon name={navOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} />
    </button>
  ) : null;

  return (
    <div
      className="shell-frame flex h-full w-full flex-col"
      style={shellFrameStyle}
      data-settled={settled ? "" : undefined}
    >
      {/* Keyboard/SR users can jump straight past the chrome to the active
          surface. Visually hidden until focused (see .skip-link in globals). */}
      <a className="skip-link" href="#shell-main-content">Skip to main content</a>
      {/* `deep` (not the bare attribute) matters: drag.js's bare value only
          drags on DIRECT presses on the attributed element, so empty chrome
          inside .menu-bar / .top-bar wrappers would short-circuit the walk and
          never drag. `deep` makes the whole subtree a drag region while
          clickable descendants still opt out. */}
      <div className="shell-top" data-tauri-drag-region="deep">
        <div className="shell-titlebar-drag-lane" data-tauri-drag-region="deep" aria-hidden="true" />
        {navToggle}
        <div className="shell-top__bar" data-tauri-drag-region="deep">{renderedTopBar}</div>
      </div>
      <div className="shell-body flex flex-1 min-h-0">
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
            <Icon name="ph:x" width={CAVE_ICON_SIZE.shellDismiss} height={CAVE_ICON_SIZE.shellDismiss} />
          </button>
        </div>
      ))}
    </div>
  );
}

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
  // mark <html> to reserve room for the traffic lights and make the top bar a
  // drag handle (see [data-tauri-titlebar] in globals.css). Browser, Windows,
  // Linux, and Tauri-mobile keep their normal chrome.
  //
  // We track this in state (not just the <html> dataset) because the CSS
  // `-webkit-app-region: drag` hint is INERT here: the webview loads from an
  // external `http://127.0.0.1` URL (see lib.rs WebviewUrl::External), and
  // WebKit only bridges `app-region: drag` into a real NSWindow drag on the
  // native `tauri://` scheme. On external URLs the hint is silently ignored,
  // which is why the CSS-only approach never actually dragged the window.
  // So when `tauriTitlebar` is on we also attach a mousedown handler that calls
  // the Tauri window API's startDragging(), which drives AppKit directly and
  // works regardless of URL scheme. The CSS stays as a progressive-
  // enhancement fallback for any bundled-scheme build.
  const [tauriTitlebar, setTauriTitlebar] = useState(false);
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
    setTauriTitlebar(true);
    return () => {
      delete root.dataset.tauriTitlebar;
      setTauriTitlebar(false);
    };
  }, []);

  // Native window drag for the macOS overlay titlebar. Fires only in the Tauri
  // macOS shell (tauriTitlebar). Ignores anything but a primary-button press
  // that lands on empty chrome — clicks on interactive controls fall through
  // so buttons/inputs keep working. Double-click still zooms the window via
  // the OS, so we only handle single-press drags.
  const onTitlebarPointerDown = useMemo(() => {
    if (!tauriTitlebar) return undefined;
    return (event: import("react").PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "button, a, input, select, textarea, kbd, label, [role='button'], [role='textbox'], [contenteditable], .menu-bar__search, .top-bar__search, .top-bar__account",
        )
      ) {
        return;
      }
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
        .catch(() => {
          // Best-effort: if the API isn't available we simply fall back to the
          // CSS app-region hint (a no-op on external URLs, but harmless).
        });
    };
  }, [tauriTitlebar]);
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

  if (!mounted) {
    return (
      <div className="shell-frame flex h-full w-full flex-col">
        <div className="shell-top" data-tauri-drag-region="" onPointerDown={onTitlebarPointerDown}>
          <div className="shell-titlebar-drag-lane" data-tauri-drag-region="" aria-hidden="true" />
          <div className="shell-top__bar" data-tauri-drag-region="">{renderedTopBar}</div>
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
        defaultSize="24%"
        minSize="14%"
        maxSize="28%"
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
      <div className="shell-top" data-tauri-drag-region="" onPointerDown={onTitlebarPointerDown}>
        <div className="shell-titlebar-drag-lane" data-tauri-drag-region="" aria-hidden="true" />
        {navToggle}
        <div className="shell-top__bar" data-tauri-drag-region="">{renderedTopBar}</div>
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

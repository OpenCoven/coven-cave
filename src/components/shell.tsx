"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ForwardedRef } from "react";
import { forwardRef } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type GroupImperativeHandle,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { useShellBanners } from "@/lib/shell-banners";
import { UpdateBannerTrigger } from "@/components/update-available";
import { OpenCovenToolsBannerTrigger } from "@/components/open-coven-tools-update";
import { CaveHomeMigrationBannerTrigger } from "@/components/cave-home-migration-banner";
import { DesktopHistoryNav } from "@/components/desktop-history-nav";
import { useIsMobile } from "@/lib/use-viewport";
import { isMacDesktopShell } from "@/lib/tauri-platform";
import { MobileDrawer, type MobileDrawerSlot } from "@/components/mobile-drawer";
import { DetailSplitHost, type DetailSplitTile } from "@/components/detail-split-host";
import { ShellPeelReveal } from "@/components/shell-peel-reveal";
import {
  eventKey,
  getPanelShortcutBindings,
  labelPanelShortcut,
  matchesPanelShortcut,
  type PanelShortcutBindings,
} from "@/lib/panel-shortcuts";
import {
  isShellNavCollapsedLayout,
  resolveShellDestinationLayout,
  resolveShellLayoutPersistence,
  resolveShellNavOpenPreference,
  resolveShellNavPolicyHandoff,
  SHELL_NAV_DEFAULT_PX,
  SHELL_NAV_MAX_PX,
  SHELL_NAV_MIN_PX,
  resolveShellNavWidth,
  type ShellPanelLayout,
} from "./shell-layout";
import {
  normalizeRightChatOpen,
  normalizeRightChatWidth,
  RIGHT_CHAT_DEFAULT_PX,
  RIGHT_CHAT_MAX_PX,
  RIGHT_CHAT_MIN_PX,
  RIGHT_CHAT_OPEN_PREF_KEY,
  RIGHT_CHAT_WIDTH_PREF_KEY,
  SHELL_DETAIL_MIN_PX,
  shouldAutoCollapseNavForRightChat,
} from "@/lib/shell-right-chat";

// Shell — multi-pane app chrome. Horizontal Group of nav/list/detail,
// optionally wrapped in a vertical Group when a bottom slot (terminal) is set.
//
// Keyboard:
//   ⌘B   toggle nav
//   ⌘\   toggle list
//   ⌃`   toggle bottom terminal

// v3: the nav now starts minimized to its icon rail by default (see the
// default-minimize layout effect below) — bumping the key retires v2 saved
// widths so the new default applies once, then the user's own resize persists.
// v2: panels went percent → pixel (see shell-left-panels-fit.test.ts); v1
// layouts hold percent widths chosen under the old monitor-scaled defaults.
const SHELL_GROUP_ID = "cave.shell.widths.v3";
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

// SSR and the first client render must see the same panel snapshot. Reading
// localStorage during hydration makes react-resizable-panels emit different
// inline flex values from the server markup. The real store is swapped in
// after mount; the existing layout effect then restores the saved group before
// enabling transitions.
const hydrationShellStorage = {
  getItem(_key: string): null {
    return null;
  },
  setItem(_key: string, _value: string): void {},
};

function togglePanel(panel: PanelImperativeHandle | null) {
  if (!panel) return;
  if (panel.isCollapsed()) panel.expand();
  else panel.collapse();
}

function applyPanelOpenState(panel: PanelImperativeHandle | null, open: boolean) {
  if (!panel || panel.isCollapsed() === !open) return;
  if (open) panel.expand();
  else panel.collapse();
}

// The minimized-by-default nav is applied exactly ONCE per group per browser,
// tracked by this flag (the panel library persists layouts under its own
// `react-resizable-panels:*` keys, so we can't reuse those; a self-owned flag is
// simpler and lets tests opt out by pre-seeding it). After the first minimize the
// library's expanded-layout persistence and the separate open preference take
// over, because we no longer re-minimize. Returns true on the server / when
// storage is unreadable, i.e. "already applied" → don't minimize.
const SHELL_MIN_APPLIED_PREFIX = "cave:shell:min-applied:";
function shellMinimizeApplied(id: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(`${SHELL_MIN_APPLIED_PREFIX}${id}`) === "1";
  } catch {
    return true;
  }
}
function markShellMinimizeApplied(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${SHELL_MIN_APPLIED_PREFIX}${id}`, "1");
  } catch {
    /* ignore — strict privacy mode or quota */
  }
}

// Cross-surface, cross-launch sidebar memory: the nav's open/collapsed state
// is ONE user preference, persisted globally. The panel library already
// persists per-GROUP layouts, but route-specific groups never see each other —
// so a sidebar collapsed on one surface came back open when the next launch (or
// a surface switch) landed on another. Boot and group switches re-apply the
// preference; only user-driven resizes write it (the code-rail auto
// collapse/restore coupling and programmatic group-swap layout churn don't).
const NAV_OPEN_PREF_KEY = "cave:shell:nav-open";
const NAV_WIDTH_PREF_KEY = "cave:shell:nav-width";
// Who wrote NAV_OPEN_PREF_KEY. The key alone can't distinguish "the user
// collapsed the sidebar" from "first-run minimization guessed collapsed", and
// those must be treated differently on a policy handoff — only the former is a
// choice worth preserving. A missing value reads as "seed", which is the safe
// direction for installs that predate this key (worst case a sidebar stays
// open).
const NAV_OPEN_SOURCE_KEY = "cave:shell:nav-open:source";
function readNavOpenPref(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NAV_OPEN_PREF_KEY);
    return raw === "1" ? true : raw === "0" ? false : null;
  } catch {
    return null;
  }
}
function readNavOpenFromUser(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NAV_OPEN_SOURCE_KEY) === "user";
  } catch {
    return false;
  }
}
function writeNavOpenPref(open: boolean, source: "user" | "seed" = "seed"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAV_OPEN_PREF_KEY, open ? "1" : "0");
    window.localStorage.setItem(NAV_OPEN_SOURCE_KEY, source);
  } catch {
    /* ignore — strict privacy mode or quota */
  }
}
function seedNavOpenPref(defaultOpen: boolean): boolean {
  const resolved = resolveShellNavOpenPreference(readNavOpenPref(), defaultOpen);
  if (resolved.shouldPersist) writeNavOpenPref(resolved.open, "seed");
  return resolved.open;
}
function readNavWidthPref(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(NAV_WIDTH_PREF_KEY);
  } catch {
    return null;
  }
}
function writeNavWidthPref(width: number): void {
  if (typeof window === "undefined" || !Number.isFinite(width)) return;
  try {
    window.localStorage.setItem(NAV_WIDTH_PREF_KEY, String(width));
  } catch {
    /* ignore — strict privacy mode or quota */
  }
}

// The left nav collapses to an icons-only rail (instead of vanishing) so the
// destination icons stay reachable. Sizes at/below the rail read as "collapsed".
const NAV_RAIL_PX = 56;
// The nav Panel's open width (its defaultSize) — the ⌘B / hover-peek expand
// target, and the basis for the minimized-by-default layout injection (the rail
// is NAV_RAIL_PX/NAV_OPEN_PX of the open width).
const NAV_OPEN_PX = SHELL_NAV_DEFAULT_PX;
const NAV_OPEN_THRESHOLD_PX = NAV_RAIL_PX + 16;

export type ShellHandle = {
  openNav: () => void;
  closeNav: () => void;
  toggleNav: () => void;
  openList: () => void;
  closeList: () => void;
  toggleList: () => void;
  openRightChat: () => void;
  closeRightChat: () => void;
  toggleRightChat: () => void;
  /** Dismiss the nav/list ONLY on mobile (where it's an overlay drawer over the
   *  content). On desktop these are persistent side panels, so selecting an
   *  option inside them must NOT collapse them — these are no-ops there. */
  dismissNavMobile: () => void;
  dismissListMobile: () => void;
};

export type ShellNavPolicy = "remembered" | "visit-collapsed" | "chat-contextual";
export type ShellListPolicy = "collapsible" | "persistent";

type ShellMobileChromeState = {
  navDrawerOpen: boolean;
  listDrawerOpen: boolean;
  rightChatDrawerOpen: boolean;
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
  rightChat,
  onRightChatOpenChange,
  onNavOpenChange,
  navPolicy = "remembered",
  listPolicy = "collapsible",
  panelShortcutOverrides,
  historyNavigation,
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
  rightChat?: ReactNode;
  onRightChatOpenChange?: (open: boolean) => void;
  /** Mobile/tablet-only bottom tab bar. Kept in hydration-stable markup after
   *  `.shell-body`; CSS displays it only at the mobile breakpoint (≤1023px). */
  mobileTabs?: ReactNode;
  onNavOpenChange?: (open: boolean) => void;
  navPolicy?: ShellNavPolicy;
  listPolicy?: ShellListPolicy;
  panelShortcutOverrides?: Partial<PanelShortcutBindings>;
  historyNavigation?: {
    canGoBack: boolean;
    canGoForward: boolean;
    goBack: () => void;
    goForward: () => void;
  };
}, ref: ForwardedRef<ShellHandle>) {
  const navRef = useRef<PanelImperativeHandle | null>(null);
  const listRef = useRef<PanelImperativeHandle | null>(null);
  const bottomRef = useRef<PanelImperativeHandle | null>(null);
  const rightChatRef = useRef<PanelImperativeHandle | null>(null);
  const rightChatToggleRef = useRef<HTMLButtonElement | null>(null);
  // Code-rail ↔ nav coupling bookkeeping (desktop only). When the code rail
  // opens we collapse the nav and remember that WE did it
  // (railAutoCollapsedNavRef); on rail close we restore it — unless the user
  // re-expanded the nav in the meantime (userOverrodeNavRef), in which case
  // their intent wins and we leave the nav alone.
  const railAutoCollapsedNavRef = useRef(false);
  const userOverrodeNavRef = useRef(false);
  const hasRightChat = rightChat != null;
  const [rightChatOpen, setRightChatOpen] = useState(false);
  const [preferredRightChatWidth, setPreferredRightChatWidth] = useState(RIGHT_CHAT_DEFAULT_PX);
  const rightChatAutoCollapsedNavRef = useRef(false);
  const rightChatNavOverrideRef = useRef(false);
  const [preferredNavWidth, setPreferredNavWidth] = useState(() =>
    resolveShellNavWidth(readNavWidthPref()),
  );
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);
  const layoutStorage = mounted ? shellStorage : hydrationShellStorage;
  const isMobile = useIsMobile();
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawerSlot>(null);
  const twoPane = !list;
  const hasBottom = !!bottom;
  const desktopRightChat = hasRightChat && !isMobile;

  useLayoutEffect(() => {
    if (!mounted || !hasRightChat) return;
    let open = false;
    let width = RIGHT_CHAT_DEFAULT_PX;
    try {
      open = normalizeRightChatOpen(window.localStorage.getItem(RIGHT_CHAT_OPEN_PREF_KEY));
      width = normalizeRightChatWidth(window.localStorage.getItem(RIGHT_CHAT_WIDTH_PREF_KEY));
    } catch {
      // closed/default is the safe storage-unavailable fallback
    }
    setPreferredRightChatWidth(width);
    setRightChatOpen(open);
    if (isMobile) {
      setMobileDrawer(open ? "right-chat" : null);
    } else {
      rightChatRef.current?.resize(`${width}px`);
      applyPanelOpenState(rightChatRef.current, open);
    }
  }, [hasRightChat, isMobile, mounted]);

  // Mobile drawer: which of the nav/list/agent panels is currently slid in
  // as a full-height overlay. On desktop this stays null and react-resizable-
  // panels owns the layout. On phones the panels stay mounted but we override
  // their position to fixed via CSS (see globals.css, @media max-width 767px);
  // this state drives the `[data-mobile-drawer]` attribute that triggers the
  // slide. We deliberately do NOT call panel.collapse/expand on mobile —
  // that would write to the persisted desktop layout for no benefit.
  // When the viewport crosses back to desktop, drop any open drawer state so
  // we don't end up with a stale [data-mobile-drawer] attribute applying to
  // a layout that's no longer in mobile mode. On mobile, if a list slot
  // disappears under an open list drawer, clear only that stale drawer so the
  // backdrop/body lock releases without unnecessarily closing an open nav drawer.
  useEffect(() => {
    if (!isMobile) {
      setMobileDrawer(null);
      return;
    }
    if (!list) setMobileDrawer((curr) => (curr === "list" ? null : curr));
  }, [isMobile, list]);

  // Seamless macOS title bar: only the macOS desktop Tauri shell overlays the
  // native title bar (lib.rs sets TitleBarStyle::Overlay). The root
  // `data-tauri-titlebar` marker that reserves room for the traffic lights is
  // owned globally by <TauriTitlebarMarker> in the root layout — the lights
  // float over EVERY route of the window (Settings, Dashboard, reports…),
  // not just this shell. Browser, Windows, Linux, and Tauri-mobile never set
  // it.
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
  const mobileChromeState: ShellMobileChromeState = {
    navDrawerOpen: isMobile && mobileDrawer === "nav",
    listDrawerOpen: isMobile && mobileDrawer === "list",
    rightChatDrawerOpen: isMobile && mobileDrawer === "right-chat",
  };
  const renderedTopBar = typeof topBar === "function" ? topBar(mobileChromeState) : topBar;
  const panelShortcuts = useMemo(
    () => getPanelShortcutBindings(panelShortcutOverrides),
    [panelShortcutOverrides],
  );
  const leftPanelShortcutLabel = labelPanelShortcut(panelShortcuts.toggleLeftPanel);
  const rightPanelShortcutLabel = labelPanelShortcut(panelShortcuts.toggleRightPanel);

  const writeRightChatOpenPref = (open: boolean) => {
    try {
      window.localStorage.setItem(RIGHT_CHAT_OPEN_PREF_KEY, open ? "1" : "0");
    } catch {}
  };
  const writeRightChatWidthPref = (width: number) => {
    try {
      window.localStorage.setItem(
        RIGHT_CHAT_WIDTH_PREF_KEY,
        String(normalizeRightChatWidth(String(width))),
      );
    } catch {}
  };

  const applyPreferredRightChatWidth = useCallback(() => {
    const group = groupRef.current;
    const groupElement = groupElementRef.current;
    if (!group || !groupElement) return;
    const layout = group.getLayout();
    const detail = layout.detail;
    const current = layout["right-chat"];
    if (typeof detail !== "number" || typeof current !== "number") return;
    const groupSize = Array.from(groupElement.children).reduce(
      (size, child) =>
        size +
        (child instanceof HTMLElement && child.hasAttribute("data-panel")
          ? child.offsetWidth
          : 0),
      0,
    );
    if (!Number.isFinite(groupSize) || groupSize <= 0) return;
    const desired = Number.parseFloat(((preferredRightChatWidth / groupSize) * 100).toFixed(3));
    if (Math.abs(desired - current) < 0.05) return;
    const nextDetail = Number.parseFloat((detail - (desired - current)).toFixed(3));
    if (nextDetail <= 0) return;
    group.setLayout({ ...layout, detail: nextDetail, "right-chat": desired });
  }, [preferredRightChatWidth]);

  const openRightChat = () => {
    if (!hasRightChat) return;
    if (isMobile) {
      setMobileDrawer("right-chat");
    } else {
      const navWidth = navRef.current?.getSize().inPixels ?? NAV_RAIL_PX;
      const listWidth = twoPane ? 0 : listRef.current?.getSize().inPixels ?? 0;
      if (
        shouldAutoCollapseNavForRightChat({
          viewportWidth: window.innerWidth,
          navWidth,
          listWidth,
          rightChatWidth: preferredRightChatWidth,
        }) &&
        navOpen
      ) {
        rightChatAutoCollapsedNavRef.current = true;
        rightChatNavOverrideRef.current = false;
        navRef.current?.collapse();
        setNavOpen(false);
      }
      applyPreferredRightChatWidth();
      rightChatRef.current?.expand();
      rightChatRef.current?.resize(`${preferredRightChatWidth}px`);
      requestAnimationFrame(() => {
        applyPreferredRightChatWidth();
        rightChatRef.current?.resize(`${preferredRightChatWidth}px`);
      });
    }
    setRightChatOpen(true);
    writeRightChatOpenPref(true);
  };

  const closeRightChat = () => {
    if (isMobile) {
      setMobileDrawer((current) => (current === "right-chat" ? null : current));
      requestAnimationFrame(() => rightChatToggleRef.current?.focus());
    } else {
      rightChatRef.current?.collapse();
      const restoreNav =
        rightChatAutoCollapsedNavRef.current && !rightChatNavOverrideRef.current;
      rightChatAutoCollapsedNavRef.current = false;
      rightChatNavOverrideRef.current = false;
      if (restoreNav) {
        navRef.current?.expand();
        setNavOpen(true);
      }
    }
    setRightChatOpen(false);
    writeRightChatOpenPref(false);
  };

  const toggleRightChat = () => {
    if (rightChatOpen) closeRightChat();
    else openRightChat();
  };

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
        if (listPolicy === "persistent") return;
        listRef.current?.collapse();
      },
      dismissListMobile: () => {
        if (isMobile) setMobileDrawer((c) => (c === "list" ? null : c));
      },
      toggleList: () => {
        if (isMobile) { toggleDrawer("list"); return; }
        if (listPolicy === "persistent") return;
        togglePanel(listRef.current);
      },
      openRightChat,
      closeRightChat,
      toggleRightChat,
    };
  }, [closeRightChat, isMobile, listPolicy, openRightChat, toggleRightChat]);

  const panelIds: string[] = ["nav"];
  if (!twoPane) panelIds.push("list");
  panelIds.push("detail");
  if (desktopRightChat) panelIds.push("right-chat");
  const chatContextual = navPolicy === "chat-contextual";
  const baseGroupId = chatContextual
    ? `${SHELL_GROUP_ID}.chat-contextual`
    : twoPane
      ? `${SHELL_GROUP_ID}.two-pane`
      : listPolicy === "persistent"
        ? `${SHELL_GROUP_ID}.persistent-list`
        : SHELL_GROUP_ID;
  const groupId = desktopRightChat ? `${baseGroupId}.right-chat` : baseGroupId;

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: groupId,
    panelIds,
    storage: layoutStorage,
  });

  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const groupElementRef = useRef<HTMLDivElement | null>(null);

  // Non-contextual navigation defaults to its icon rail, so SSR and hydration
  // match the Cave's minimized default. The mounted layout effects restore a
  // remembered open panel before the first post-hydration paint.
  const [navOpen, setNavOpen] = useState(chatContextual);
  // Mirror of navOpen for effects that need the CURRENT visible state without
  // taking navOpen as a dependency (the policy handoff must fire on the policy
  // change, not on every sidebar toggle).
  const navOpenRef = useRef(navOpen);
  navOpenRef.current = navOpen;
  const defaultNavSize =
    chatContextual || mounted ? `${NAV_OPEN_PX}px` : `${NAV_RAIL_PX}px`;

  // Hover-to-peek: when the desktop nav is collapsed to its icon rail, hovering
  // floats it open as an overlay (navPeeking) without changing the collapse
  // state. Reset whenever the rail goes away (expanded or mobile).
  const [navPeeking, setNavPeeking] = useState(false);
  // Every desktop policy now collapses to the rail, so peek applies to all of
  // them. It used to be remembered-only because Chat collapsed to zero width,
  // leaving nothing to hover.
  const navPeekEnabled = !isMobile && !navOpen;
  const navPeekVisible = navPeekEnabled && navPeeking;
  useEffect(() => {
    if (!navPeekEnabled) setNavPeeking(false);
  }, [navPeekEnabled]);

  // Dia-style traffic lights: on the macOS desktop shell the native
  // close/minimize/zoom buttons float over the side panel's top edge. With
  // the panel fully closed (not even hover-peeked) they'd hover over page
  // content, so they follow the panel — hidden with it, back the moment it
  // opens or peeks. The root attribute lets globals.css release the 78px
  // title-bar inset; the native call is an app command
  // (set_traffic_lights_visible in lib.rs), so it needs no ACL entry. Mobile
  // layouts keep their drawer chrome and never hide the lights.
  //
  // Fit contract (title-bar overlap bug): the inset is released ONLY after
  // the native hide is confirmed. Showing is marked optimistically (worst
  // case: a roomy bar), but marking "hidden" before the buttons actually
  // vanish — pre-update shell without the command, an AppKit hiccup — slid
  // the nav toggle + history chevrons underneath still-visible lights.
  const trafficLightsVisible = navOpen || navPeekVisible || isMobile;
  useEffect(() => {
    const root = document.documentElement;
    // Only the macOS desktop Tauri shell overlays the title bar; everywhere
    // else there are no lights to manage. Detected directly (not via the
    // root marker) so this effect can't race <TauriTitlebarMarker />'s mount.
    if (!isMacDesktopShell()) return;
    let cancelled = false;
    const applyNative = (visible: boolean) =>
      import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("set_traffic_lights_visible", { visible }),
      );
    if (trafficLightsVisible) {
      root.dataset.trafficLights = "visible";
      void applyNative(true).catch(() => {});
    } else {
      void applyNative(false)
        .then(() => {
          if (!cancelled) root.dataset.trafficLights = "hidden";
        })
        .catch(() => {
          // Pre-update shell without the command — the buttons stay put, so
          // the bar must keep the 78px inset reserved for them.
          if (!cancelled) root.dataset.trafficLights = "visible";
        });
    }
    // macOS re-shows the standard buttons on its own after some window
    // transitions (fullscreen round-trips, space changes). Re-assert the
    // intended state whenever the window regains focus so the bar and the
    // buttons can't drift apart mid-session.
    const onFocus = () => {
      if (trafficLightsVisible) return;
      void applyNative(false).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      // If the shell ever unmounts mid-hide, leave the window usable.
      delete root.dataset.trafficLights;
      void applyNative(true).catch(() => {});
    };
  }, [trafficLightsVisible]);

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

  // Minimize remembered and visit-collapsed navigation by default. Once the group
  // has settled (the library has applied its initial open layout), replace the
  // WHOLE layout with one where the nav is at its rail width and the freed width
  // goes to the detail pane, via the group-level setLayout. Once per fresh
  // groupId; a group the user has resized (a saved layout) is respected. Chat's
  // contextual sidebar opens at its dedicated list-like width instead.
  const minimizedGroupsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!settled || isMobile || chatContextual) return;
    if (minimizedGroupsRef.current.has(groupId) || shellMinimizeApplied(groupId)) return;
    const group = groupRef.current;
    if (!group) return;
    const cur = group.getLayout();
    const nav = cur.nav;
    if (typeof nav !== "number" || typeof cur.detail !== "number") return;
    const railPct = nav * (NAV_RAIL_PX / preferredNavWidth);
    if (railPct >= nav) return; // already at/under the rail
    minimizedGroupsRef.current.add(groupId);
    seedNavOpenPref(false);
    markShellMinimizeApplied(groupId);
    group.setLayout({ ...cur, nav: railPct, detail: cur.detail + (nav - railPct) });
  }, [settled, isMobile, groupId, chatContextual, preferredNavWidth]);

  // Policy handoff — MUST stay declared above the destination-layout effect
  // below, because useLayoutEffects run in declaration order and that one reads
  // the preference this one repairs.
  //
  // Leaving Chat swaps `chat-contextual` for `remembered` AND changes groupId,
  // so the restore effect re-reads `cave:shell:nav-open`. Chat never maintains
  // that key (its persistence branch is gated on the remembered policy) while
  // first-run minimization seeds it to `false` — so the sidebar the user was
  // looking at, and had just clicked "Home" inside, collapsed to the rail. Carry
  // the visible state across instead. An explicit user collapse still wins; see
  // resolveShellNavPolicyHandoff.
  const navHandoffPolicyRef = useRef<ShellNavPolicy | null>(null);
  useLayoutEffect(() => {
    if (!mounted) return;
    const fromPolicy = navHandoffPolicyRef.current;
    navHandoffPolicyRef.current = navPolicy;
    if (isMobile) return;
    const handoff = resolveShellNavPolicyHandoff({
      fromPolicy,
      toPolicy: navPolicy,
      visibleNavOpen: navOpenRef.current,
      persistedOpen: readNavOpenPref(),
      persistedFromUser: readNavOpenFromUser(),
    });
    if (!handoff) return;
    // Seed, not "user": carrying state forward is not the user expressing a
    // preference, so a later genuine toggle still outranks it.
    if (handoff.persist) writeNavOpenPref(handoff.open, "seed");
  }, [mounted, isMobile, navPolicy]);

  // The library retains an in-memory layout by panel-id set when Group's id
  // changes. Restore the destination group's complete saved/default layout
  // before applying its open/collapsed policy so widths cannot cross groups.
  const navPrefArmedGroupRef = useRef<string | null>(null);
  const layoutPersistenceGroupRef = useRef<string | null>(null);
  const expandedLayoutRef = useRef<{ groupId: string; layout: ShellPanelLayout } | null>(null);
  const collapsedLayoutRef = useRef<{ groupId: string; layout: ShellPanelLayout } | null>(null);
  const restoredGroupRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!mounted || isMobile) {
      if (isMobile) {
        layoutPersistenceGroupRef.current = null;
        expandedLayoutRef.current = null;
        collapsedLayoutRef.current = null;
        restoredGroupRef.current = null;
      }
      return;
    }
    if (restoredGroupRef.current === groupId) return;
    navPrefArmedGroupRef.current = null;

    const group = groupRef.current;
    const groupElement = groupElementRef.current;
    if (!group || !groupElement) return;

    // react-resizable-panels measures the sum of panel widths, excluding its
    // separators, when converting pixel defaults to percentages.
    const groupSize = Array.from(groupElement.children).reduce(
      (size, child) =>
        size +
        (child instanceof HTMLElement && child.hasAttribute("data-panel")
          ? child.offsetWidth
          : 0),
      0,
    );
    // Still gated on !chatContextual: Chat must never write the REMEMBERED
    // preference (cave:shell:nav-open). Chat collapsing to a rail changes what
    // the panel looks like, not who owns that preference — the handoff added in
    // #4404 depends on Chat leaving it alone.
    if (
      !chatContextual &&
      isShellNavCollapsedLayout({
        layout: defaultLayout,
        panelIds,
        groupSize,
        collapsedNavPixels: NAV_RAIL_PX,
      })
    ) {
      seedNavOpenPref(false);
    }
    const rememberedNavOpen =
      navPolicy === "remembered" ? seedNavOpenPref(false) : null;
    const destinationLayout = resolveShellDestinationLayout({
      panelIds,
      savedLayout: defaultLayout,
      groupSize,
      defaultPanelPixels: {
        ...(!twoPane && { list: 260 }),
        ...(desktopRightChat && { "right-chat": preferredRightChatWidth }),
      },
      preferredNavPixels: preferredNavWidth,
      // Matches the Panel's collapsedSize below — Chat collapses to the rail
      // now, not to zero, so the restored layout must describe the same width.
      collapsedNavPixels: isMobile ? 0 : NAV_RAIL_PX,
      isMobile,
    });
    if (!destinationLayout) return;

    // Group keeps an in-memory layout keyed only by panel ids, even after its
    // id changes. Arm persistence immediately before replacing that stale
    // source layout so transition churn cannot overwrite the destination.
    expandedLayoutRef.current = { groupId, layout: destinationLayout };
    collapsedLayoutRef.current = null;
    layoutPersistenceGroupRef.current = groupId;
    restoredGroupRef.current = groupId;
    group.setLayout(destinationLayout);
    if (rememberedNavOpen !== null) {
      railAutoCollapsedNavRef.current = false;
      userOverrodeNavRef.current = false;
      applyPanelOpenState(navRef.current, rememberedNavOpen);
      setNavOpen(rememberedNavOpen);
      minimizedGroupsRef.current.add(groupId);
      markShellMinimizeApplied(groupId);
    }
  }, [
    mounted,
    isMobile,
    groupId,
    chatContextual,
    defaultLayout,
    twoPane,
    navPolicy,
    desktopRightChat,
    preferredNavWidth,
    preferredRightChatWidth,
  ]);

  const previousNavPolicyRef = useRef<ShellNavPolicy>("remembered");
  const visitCollapsedGroupRef = useRef<string | null>(null);
  const chatContextualGroupRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!mounted) return;
    if (navPolicy === "chat-contextual") {
      visitCollapsedGroupRef.current = null;
      navPrefArmedGroupRef.current = null;
      if (
        previousNavPolicyRef.current !== navPolicy ||
        chatContextualGroupRef.current !== groupId
      ) {
        chatContextualGroupRef.current = groupId;
        setNavOpen(true);
      }
      previousNavPolicyRef.current = navPolicy;
      return;
    }
    chatContextualGroupRef.current = null;
    if (navPolicy !== "visit-collapsed") {
      visitCollapsedGroupRef.current = null;
      previousNavPolicyRef.current = navPolicy;
      return;
    }
    if (isMobile) {
      previousNavPolicyRef.current = navPolicy;
      return;
    }
    if (
      previousNavPolicyRef.current !== navPolicy ||
      visitCollapsedGroupRef.current !== groupId
    ) {
      navPrefArmedGroupRef.current = null;
      visitCollapsedGroupRef.current = groupId;
      navRef.current?.collapse();
      setNavOpen(false);
    }
    previousNavPolicyRef.current = navPolicy;
  }, [mounted, groupId, isMobile, navPolicy]);

  // Apply the remembered sidebar state on boot and after the destination layout
  // is restored. Non-remembered policies neither consult nor overwrite the
  // global preference. Writes stay disarmed throughout group-swap layout churn.
  useEffect(() => {
    if (navPolicy !== "remembered") {
      navPrefArmedGroupRef.current = null;
      return;
    }
    if (!settled || isMobile) return;
    const pref = seedNavOpenPref(false);
    const panel = navRef.current;
    if (panel && !railAutoCollapsedNavRef.current) {
      if (pref && panel.isCollapsed()) {
        panel.expand();
        setNavOpen(true);
      } else if (!pref && !panel.isCollapsed()) {
        panel.collapse();
        setNavOpen(false);
      }
    }
    navPrefArmedGroupRef.current = groupId;
  }, [settled, isMobile, groupId, navPolicy]);

  useLayoutEffect(() => {
    if (!settled || !desktopRightChat) return;
    applyPreferredRightChatWidth();
    if (rightChatOpen) {
      rightChatRef.current?.resize(`${preferredRightChatWidth}px`);
    }
    applyPanelOpenState(rightChatRef.current, rightChatOpen);
  }, [applyPreferredRightChatWidth, desktopRightChat, groupId, preferredRightChatWidth, rightChatOpen, settled]);

  useEffect(() => {
    onNavOpenChange?.(navOpen);
  }, [navOpen, onNavOpenChange]);

  useEffect(() => {
    onRightChatOpenChange?.(hasRightChat ? rightChatOpen : false);
  }, [hasRightChat, onRightChatOpenChange, rightChatOpen]);

  useEffect(() => {
    const toggleDrawerSlot = (slot: NonNullable<MobileDrawerSlot>) => {
      setMobileDrawer((curr) => (curr === slot ? null : slot));
    };
    const toggleDesktopNav = () => {
      const panel = navRef.current;
      if (!panel) return;

      if (panel.isCollapsed()) {
        panel.expand();
        setNavOpen(true);
      } else {
        panel.collapse();
        setNavOpen(false);
      }
    };
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable =
        target?.matches("input, textarea, select, [contenteditable='true'], [role='textbox']") ?? false;
      if (!editable && hasRightChat && matchesPanelShortcut(e, panelShortcuts.toggleRightPanel)) {
        e.preventDefault();
        toggleRightChat();
        return;
      }
      if (matchesPanelShortcut(e, panelShortcuts.toggleLeftPanel)) {
        e.preventDefault();
        if (isMobile) toggleDrawerSlot("nav");
        else toggleDesktopNav();
        return;
      }
      // Same guard as matchesPanelShortcut above: an event with no readable key
      // is ignored rather than thrown on. Guarding only the call above would
      // just move the crash down to this line (cave-lryhx).
      const key = eventKey(e);
      if (key === null) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && key === "\\" && !twoPane) {
        e.preventDefault();
        if (isMobile) toggleDrawerSlot("list");
        else if (listPolicy === "collapsible") togglePanel(listRef.current);
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
    // Symmetric hook for sidebar content that needs to reopen the left panel
    // without owning its panel ref.
    const onToggleLeft = () => {
      if (isMobile) toggleDrawerSlot("nav");
      else toggleDesktopNav();
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keydown", bottomToggle);
    window.addEventListener("cave:toggle-left-panel", onToggleLeft);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keydown", bottomToggle);
      window.removeEventListener("cave:toggle-left-panel", onToggleLeft);
    };
  }, [twoPane, hasBottom, hasRightChat, isMobile, listPolicy, panelShortcuts, preferredRightChatWidth, rightChatOpen, toggleRightChat]);

  // Couple the left nav to the code rail (desktop only — mobile nav is a
  // drawer, so this must never touch it). When the rail opens we collapse the
  // nav to preserve detail space; when it closes we restore the nav UNLESS the
  // user re-expanded it while the rail was open.
  useEffect(() => {
    const onRailVisibility = (e: Event) => {
      const open = (e as CustomEvent<{ open?: boolean }>).detail?.open ?? false;
      if (isMobile) return;
      if (open) {
        // Rail became visible: collapse the nav only if it's currently open,
        // and remember we did it so we can restore later. The flag is raised
        // BEFORE collapse() so the resulting onResize is recognized as
        // programmatic and doesn't overwrite the persisted nav preference.
        if (navOpen) {
          railAutoCollapsedNavRef.current = true;
          userOverrodeNavRef.current = false;
          navRef.current?.collapse();
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
    if (navOpen && rightChatAutoCollapsedNavRef.current) {
      rightChatNavOverrideRef.current = true;
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
      rightChatAutoCollapsedNavRef.current = false;
      rightChatNavOverrideRef.current = false;
    }
  }, [isMobile]);

  const horizontalGroup = (
    <Group
      className="shell-root flex-1 min-h-0"
      orientation="horizontal"
      groupRef={groupRef}
      elementRef={groupElementRef}
      defaultLayout={isMobile ? undefined : defaultLayout}
      onLayoutChanged={(layout, meta) => {
        if (layoutPersistenceGroupRef.current !== groupId) return;
        const navCollapsed = navRef.current?.isCollapsed() ?? true;
        const persistedLayout = resolveShellLayoutPersistence({
          isMobile,
          navCollapsed,
          layout,
          savedExpandedLayout:
            expandedLayoutRef.current?.groupId === groupId
              ? expandedLayoutRef.current.layout
              : undefined,
          previousCollapsedLayout:
            collapsedLayoutRef.current?.groupId === groupId
              ? collapsedLayoutRef.current.layout
              : undefined,
        });
        if (!persistedLayout) return;
        collapsedLayoutRef.current = navCollapsed ? { groupId, layout } : null;
        expandedLayoutRef.current = { groupId, layout: persistedLayout };
        onLayoutChanged(persistedLayout, meta);

        // Unlike Panel.onResize, Group.onLayoutChanged identifies a completed
        // direct separator interaction. This excludes observer, window-resize,
        // mount, and imperative-layout notifications.
        const pixelWidth = navRef.current?.getSize().inPixels;
        if (
          !isMobile &&
          meta.isUserInteraction &&
          !navCollapsed &&
          Number.isFinite(pixelWidth) &&
          !railAutoCollapsedNavRef.current
        ) {
          const normalizedWidth = resolveShellNavWidth(String(pixelWidth));
          writeNavWidthPref(normalizedWidth);
          setPreferredNavWidth(normalizedWidth);
        }
        const rightChatWidth = rightChatRef.current?.getSize().inPixels;
        if (
          hasRightChat &&
          meta.isUserInteraction &&
          Number.isFinite(rightChatWidth)
        ) {
          const open = rightChatWidth! >= RIGHT_CHAT_MIN_PX;
          setRightChatOpen(open);
          writeRightChatOpenPref(open);
          if (open) {
            const normalized = normalizeRightChatWidth(String(rightChatWidth));
            setPreferredRightChatWidth(normalized);
            writeRightChatWidthPref(normalized);
          }
        }
      }}
      data-mobile-drawer={isMobile && mobileDrawer ? mobileDrawer : undefined}
    >
      <Panel
        id="nav"
        className={`shell-nav-panel${navOpen ? " shell-nav-panel--open" : ""}`}
        // Chat uses list-like sizing for contextual workspace/session content.
        // Normal navigation keeps NAV_OPEN_PX as the ⌘B / hover-peek target.
        defaultSize={defaultNavSize}
        minSize={`${SHELL_NAV_MIN_PX}px`}
        maxSize={`${SHELL_NAV_MAX_PX}px`}
        collapsible
        // Contextual Chat and mobile drawers close fully; normal desktop
        // navigation collapses to its icons-only rail.
        // Mobile drawers close fully (they overlay the content). Every desktop
        // surface — Chat included — collapses to the icons-only rail instead,
        // so the destinations stay reachable. Chat used to collapse to zero,
        // which left no rail, no peek target, and no visible way to reach any
        // other surface.
        collapsedSize={isMobile ? 0 : NAV_RAIL_PX}
        panelRef={navRef}
        onResize={(size) => {
          const open = (size.inPixels ?? 0) > NAV_OPEN_THRESHOLD_PX;
          setNavOpen(open);
          // Persist user-driven changes only: the group must be armed (boot /
          // group-swap layout churn is programmatic) and the code rail must
          // not be mid-auto-collapse (its restore path clears the flag before
          // expanding, so the restore correctly re-records "open").
          if (
            !isMobile &&
            navPolicy === "remembered" &&
            navPrefArmedGroupRef.current === groupId &&
            !railAutoCollapsedNavRef.current
          ) {
            // The ONE user-authored write — everything else that touches this
            // key is seeding, and the policy handoff must be able to tell them
            // apart.
            writeNavOpenPref(open, "user");
          }
        }}
      >
        {/* CHAT-D13-05: every complementary landmark carries a distinct
            accessible name (axe landmark-unique). */}
        <aside
          className={`shell-nav${!isMobile && !navOpen ? (navPeekVisible ? " shell-nav--peek" : " shell-nav--rail") : ""}`}
          aria-label="Sidebar"
          onMouseEnter={navPeekEnabled ? () => setNavPeeking(true) : undefined}
          onMouseLeave={navPeekEnabled ? () => setNavPeeking(false) : undefined}
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
            collapsible={isMobile || listPolicy === "collapsible"}
            collapsedSize={0}
            panelRef={listRef}
          >
            <aside className="shell-list" aria-label="List pane">{list}</aside>
          </Panel>
          <Separator className="shell-separator" />
        </>
      )}
      <Panel id="detail" className="shell-detail-panel" minSize={`${SHELL_DETAIL_MIN_PX}px`}>
        <main className="shell-detail" id="shell-main-content" tabIndex={-1} ref={detailElRef}>
          {/* Peel-reveal (cave-3vgd): decorative page-curl toward the collapsed
              rail on HTML-in-canvas browsers; a bare Fragment everywhere else
              (no wrapper elements, so the `.shell-detail > .cave-mode-fade`
              chains keep matching). The interactive reveal stays the hover-peek. */}
          <ShellPeelReveal active={navPeekEnabled} under={nav}>
            <UpdateBannerTrigger />
            <OpenCovenToolsBannerTrigger />
            <CaveHomeMigrationBannerTrigger />
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
          </ShellPeelReveal>
        </main>
      </Panel>
      {desktopRightChat ? (
        <>
          <Separator className="shell-separator" />
          <Panel
            id="right-chat"
            className="shell-right-chat-panel"
            defaultSize={`${preferredRightChatWidth}px`}
            minSize={`${RIGHT_CHAT_MIN_PX}px`}
            maxSize={`${RIGHT_CHAT_MAX_PX}px`}
            collapsible
            collapsedSize={0}
            panelRef={rightChatRef}
            onResize={(size) => {
              if ((size.inPixels ?? 0) <= 0) setRightChatOpen(false);
            }}
          >
            <div id="shell-right-chat-panel" className="shell-right-chat">
              {rightChat}
            </div>
          </Panel>
        </>
      ) : null}
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
  const navToggle = (
    <button
      type="button"
      className={`shell-top-toggle shell-top-toggle--nav focus-ring${navOpen ? " shell-top-toggle--active" : ""}`}
      aria-label={chatContextual
        ? navOpen
          ? "Collapse Chat sidebar"
          : "Expand Chat sidebar"
        : navOpen
          ? "Collapse navigation to icons"
          : "Expand navigation"}
      aria-expanded={navOpen}
      title={chatContextual
        ? navOpen
          ? `Collapse Chat sidebar (${leftPanelShortcutLabel})`
          : `Expand Chat sidebar (${leftPanelShortcutLabel})`
        : navOpen
          ? `Collapse navigation (${leftPanelShortcutLabel})`
          : `Expand navigation (${leftPanelShortcutLabel})`}
      onClick={toggleNavPanel}
    >
      <Icon name={navOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} />
    </button>
  );
  const rightChatToggle = (
    hasRightChat ? (
      <button
        ref={rightChatToggleRef}
        type="button"
        className={`shell-top-toggle shell-top-toggle--right focus-ring${rightChatOpen ? " shell-top-toggle--active" : ""}`}
        aria-label={rightChatOpen ? "Close Chat panel" : "Open Chat panel"}
        aria-expanded={rightChatOpen}
        aria-controls={isMobile ? "shell-right-chat-drawer" : "shell-right-chat-panel"}
        title={`${rightChatOpen ? "Close" : "Open"} Chat panel (${rightPanelShortcutLabel})`}
        onClick={toggleRightChat}
      >
        <Icon
          name={rightChatOpen ? "ph:chat-circle-dots-fill" : "ph:chat-circle-dots"}
          width={CAVE_ICON_SIZE.shellToggle}
          height={CAVE_ICON_SIZE.shellToggle}
        />
      </button>
    ) : null
  );
  // Workspace owns its destination stack, while the other shell surfaces use
  // browser history. Keep the app-scoped boundary controls intact there and
  // reuse the shared browser controls everywhere else.
  const historyNav = historyNavigation ? (
      <div className="shell-top-history" role="group" aria-label="History">
        <button
          type="button"
          className="shell-top-toggle focus-ring"
          aria-label="Go back"
          title={historyNavigation.canGoBack ? "Back" : "No previous destination"}
          disabled={!historyNavigation?.canGoBack}
          onClick={historyNavigation.goBack}
        >
          <Icon name="ph:caret-left" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} />
        </button>
        <button
          type="button"
          className="shell-top-toggle focus-ring"
          aria-label="Go forward"
          title={historyNavigation.canGoForward ? "Forward" : "No next destination"}
          disabled={!historyNavigation?.canGoForward}
          onClick={historyNavigation.goForward}
        >
          <Icon name="ph:caret-right" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} />
        </button>
      </div>
    ) : <DesktopHistoryNav />;

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
        {historyNav}
        <div className="shell-top__bar" data-tauri-drag-region="deep">{renderedTopBar}</div>
        {rightChatToggle}
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
      {mobileTabs ?? null}
      <MobileDrawer
        open={isMobile ? mobileDrawer : null}
        onClose={() => {
          if (mobileDrawer === "right-chat") closeRightChat();
          else setMobileDrawer(null);
        }}
        rightChat={isMobile ? rightChat : undefined}
      />
    </div>
  );
}

export const Shell = forwardRef<ShellHandle, Parameters<typeof ShellInner>[0]>(ShellInner);

function ShellBannerStrip() {
  const { banners, dismissBanner } = useShellBanners();
  useEffect(() => {
    window.dispatchEvent(new Event("cave:native-webview-layout"));
  }, [banners]);
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

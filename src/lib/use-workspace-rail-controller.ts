"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { fetchChangesSummary } from "@/lib/changes-summary-fetch";
import { killPtyBridge } from "@/lib/pty-ws-bridge";
import { useCodeRail } from "@/lib/use-code-rail";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useIsMobile } from "@/lib/use-viewport";
import type { PendingCodeOpen } from "@/lib/pending-code-open";

type Args = {
  containerRef: RefObject<HTMLElement | null>;
  projectRoot: string | null;
  sessionId: string | null;
  sessionRunning: boolean;
  active?: boolean;
  onActivate?: () => void;
  stopTerminalOnUnmount?: boolean;
};

function stopRailTerminal(sessionId: string) {
  const threadId = `cave.rail.${sessionId}`;
  const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  if (internals) {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("pty_stop", { threadId }))
      .catch(() => {});
  }
  killPtyBridge(threadId);
}

export function useWorkspaceRailController({
  containerRef,
  projectRoot,
  sessionId,
  sessionRunning,
  active = true,
  onActivate,
  stopTerminalOnUnmount = false,
}: Args) {
  const isMobile = useIsMobile();
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth;
      setPaneWidth((previous) => previous === width ? previous : width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);
  const paneNarrow = paneWidth === null ? isMobile : paneWidth < 680;

  const [browseRootOverride, setBrowseRootOverride] = useState<string | null>(null);
  const effectiveProjectRoot = browseRootOverride ?? projectRoot;
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const changeCountRootRef = useRef<string | null>(null);

  useEffect(() => {
    if (!effectiveProjectRoot) {
      setChangeCount(null);
      changeCountRootRef.current = null;
      return;
    }
    const root = effectiveProjectRoot;
    if (changeCountRootRef.current !== root) {
      setChangeCount(null);
      changeCountRootRef.current = root;
    }
    let cancelled = false;
    let inFlight = false;
    const load = async (opts?: { force?: boolean }) => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { httpOk, json } = await fetchChangesSummary(root, opts);
        if (!cancelled) setChangeCount(httpOk && json.ok ? (json.files?.length ?? 0) : null);
      } catch {
        if (!cancelled) setChangeCount(null);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const refresh = () => void load({ force: true });
    window.addEventListener("cave:changes-refresh", refresh);
    const intervalId = sessionRunning
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void load();
        }, 5000)
      : undefined;
    return () => {
      cancelled = true;
      window.removeEventListener("cave:changes-refresh", refresh);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [effectiveProjectRoot, sessionRunning]);

  const [terminalOpened, setTerminalOpened] = useState(false);
  const rail = useCodeRail({
    projectRoot: effectiveProjectRoot,
    changeCount,
    terminalActive: terminalOpened,
    browseActive: browseRootOverride !== null,
  });
  const [focus, setFocus] = useState<PendingCodeOpen | null>(null);
  useEffect(() => {
    if (rail.activeTab === "terminal" && rail.open) setTerminalOpened(true);
  }, [rail.activeTab, rail.open]);

  const terminalSessionRef = useRef<string | null>(sessionId);
  const terminalOpenedRef = useRef(false);
  useEffect(() => {
    terminalOpenedRef.current = terminalOpened;
  }, [terminalOpened]);
  useEffect(() => {
    const previous = terminalSessionRef.current;
    terminalSessionRef.current = sessionId;
    if (previous === sessionId) return;
    if (previous && terminalOpened) {
      stopRailTerminal(previous);
    }
    setTerminalOpened(false);
    setBrowseRootOverride(null);
  }, [sessionId, terminalOpened]);
  useEffect(() => () => {
    const ownedSession = terminalSessionRef.current;
    if (stopTerminalOnUnmount && ownedSession && terminalOpenedRef.current) {
      stopRailTerminal(ownedSession);
    }
  }, [stopTerminalOnUnmount]);

  // Visibility gates on `active` so an inactive scope (e.g. ChatSurface on a
  // non-conversation tab) never reports an open rail to the shell/layout.
  const showInline = active && rail.available && rail.open && !isMobile && !paneNarrow;
  const mobileAvailable = active && (isMobile || paneNarrow) && rail.available;
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileSheetRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(mobileOpen, mobileSheetRef, { onEscape: () => setMobileOpen(false) });
  useEffect(() => {
    if (!rail.available || (!isMobile && !paneNarrow) || !active) setMobileOpen(false);
  }, [active, isMobile, paneNarrow, rail.available]);

  const openTarget = useCallback((target: PendingCodeOpen) => {
    onActivate?.();
    setBrowseRootOverride(target.kind === "files" ? (target.root ?? null) : null);
    rail.reopen();
    rail.setActiveTab(target.kind === "changes" ? "changes" : "files");
    setFocus(target);
    if (isMobile || paneNarrow) setMobileOpen(true);
  }, [isMobile, onActivate, paneNarrow, rail]);

  const openChanges = useCallback(() => {
    onActivate?.();
    setBrowseRootOverride(null);
    rail.reopen();
    rail.setActiveTab("changes");
    if (isMobile || paneNarrow) setMobileOpen(true);
  }, [isMobile, onActivate, paneNarrow, rail]);

  // File/diff/browse open events (cave:open-project-file, cave:open-file-diff,
  // cave:browse-project-files) are workspace-level concerns now — they route
  // to the Code surface (cave-ohcj), not this rail. The rail keeps only its
  // surface-internal "show changes" affordance.
  useEffect(() => {
    window.addEventListener("cave:changes-open", openChanges);
    return () => {
      window.removeEventListener("cave:changes-open", openChanges);
    };
  }, [openChanges]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("cave:code-rail-visibility", { detail: { open: showInline } }));
  }, [showInline]);
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent("cave:code-rail-visibility", { detail: { open: false } }));
  }, []);

  const collapse = () => {
    setBrowseRootOverride(null);
    rail.collapse();
  };
  const closeMobile = () => {
    setBrowseRootOverride(null);
    setMobileOpen(false);
  };

  return {
    rail,
    changeCount,
    effectiveProjectRoot,
    focus,
    isMobile,
    paneNarrow,
    showInline,
    mobileAvailable,
    mobileOpen,
    setMobileOpen,
    mobileSheetRef,
    openTarget,
    openChanges,
    collapse,
    closeMobile,
  };
}

export type WorkspaceRailController = ReturnType<typeof useWorkspaceRailController>;

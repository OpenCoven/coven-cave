"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@/styles/quick-chat-glass.css";
import "@/styles/notch-quick-chat.css";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/lib/icon";
import { QuickChatTabPane, type TabReport } from "@/components/tray-quick-chat";

/**
 * The centered-notch presentation of quick chat (the `/notch` route, loaded
 * by show_notch_window in src-tauri/src/lib.rs).
 *
 * The Rust shell parks a tiny always-on-top frameless window flush with the
 * top-center of the primary monitor — the "notch". Clicking the pill expands
 * it in place into a full quick chat (the same QuickChatTabPane the tray
 * window uses, so every traditional operation — familiar/project pickers,
 * thinking/speed/model, slash commands, queueing, open-in-app — is here).
 *
 * Geometry stays in Rust: this page only emits intents (`notch:expand`,
 * `notch:collapse`, `notch:detach`, `notch:dock-to-tray`; see
 * capabilities/loopback-notch.json) and animates its own content. The notch
 * collapses when a send starts (the pane stays mounted, so the reply keeps
 * streaming and the pill pulses), on Escape, or on the pill/collapse button;
 * the detach button folds it up and opens the traditional floating
 * quick-chat window; the dock button moves the icon back to the menu bar.
 *
 * Glass: same handshake as the tray window — the shell appends ?glass=1 only
 * when it actually opened the window transparent over macOS vibrancy.
 */

/** Matches the panel's CSS transition so the window shrink lands after it. */
const COLLAPSE_ANIMATION_MS = 180;

async function emitNotch(event: string): Promise<void> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(event, null);
  } catch {
    // Plain browser (e2e/dev): there is no shell to resize the window, but
    // the CSS states still flip so the surface remains inspectable.
  }
}

export function NotchQuickChat() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("glass") === "1") {
      document.documentElement.dataset.glass = "1";
    }
  }, []);

  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<TabReport | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const handleReport = useCallback((_id: number, next: TabReport) => setReport(next), []);

  const expand = useCallback(() => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    // Grow the window first so the panel has room to animate into.
    void emitNotch("notch:expand");
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
    // Let the panel's exit transition play inside the still-tall window,
    // then ask the shell to shrink back to the pill.
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => {
      collapseTimer.current = null;
      void emitNotch("notch:collapse");
    }, COLLAPSE_ANIMATION_MS);
  }, []);

  // Closes on send: the moment a send starts the notch folds up. The pane
  // stays mounted, so the familiar's reply keeps streaming behind the pill.
  const sending = report?.sending ?? false;
  const prevSendingRef = useRef(false);
  useEffect(() => {
    if (sending && !prevSendingRef.current) collapse();
    prevSendingRef.current = sending;
  }, [sending, collapse]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, collapse]);

  // Detachable: fold the notch up and hand off to the traditional floating
  // quick-chat window (movable, resizable, multi-tab).
  const detach = useCallback(() => {
    setExpanded(false);
    void emitNotch("notch:detach");
  }, []);

  const dockToTray = useCallback(() => {
    void emitNotch("notch:dock-to-tray");
  }, []);

  const pillLabel = report?.familiar?.display_name ?? "Quick chat";

  return (
    <main className="notch-quick-chat" data-expanded={expanded ? "1" : undefined}>
      <h1 className="sr-only">Notch quick chat</h1>
      <button
        type="button"
        className="focus-ring notch-quick-chat__pill"
        aria-expanded={expanded}
        aria-controls="notch-quick-chat-panel"
        title={expanded ? "Collapse quick chat" : "Open quick chat"}
        onClick={expanded ? collapse : expand}
      >
        <Icon name="ph:chat-circle-dots" width={14} aria-hidden />
        <span className="notch-quick-chat__pill-label">{pillLabel}</span>
        {sending ? <span className="quick-tab__pulse" role="img" aria-label="Replying…" /> : null}
      </button>

      <section
        id="notch-quick-chat-panel"
        className="notch-quick-chat__panel"
        aria-hidden={!expanded}
      >
        <header className="notch-quick-chat__toolbar">
          <p className="min-w-0 flex-1 truncate text-xs text-[var(--fg-muted)]">
            Sends collapse the notch · Esc closes
          </p>
          <IconButton
            icon="ph:arrows-out-simple"
            size="xs"
            aria-label="Detach into floating quick chat"
            title="Detach into floating quick chat"
            onClick={detach}
          />
          <IconButton
            icon="ph:tray"
            size="xs"
            aria-label="Move back to menu bar"
            title="Move back to menu bar"
            onClick={dockToTray}
          />
          <IconButton
            icon="ph:caret-up"
            size="xs"
            aria-label="Collapse quick chat"
            title="Collapse quick chat (Esc)"
            onClick={collapse}
          />
        </header>
        <QuickChatTabPane
          tabId={1}
          active={expanded}
          initialFamiliarId={null}
          showAgentPicker={false}
          onReport={handleReport}
        />
      </section>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@/styles/quick-chat-glass.css";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { useQuickChat } from "@/lib/use-quick-chat";
import {
  FamiliarMark,
  QuickChatComposer,
  QuickChatControlsRow,
  QuickChatThread,
  useSuggestionPicker,
} from "@/components/quick-chat-controls";

/**
 * The standalone quick-chat tray window (frameless, always-on-top; created by
 * show_quick_chat_window in src-tauri/src/lib.rs).
 *
 * Holds MULTIPLE quick chats at once: a tab strip in the header, the add
 * button (or ⌘/Ctrl+N) opens a fresh chat that inherits the active tab's
 * familiar, ⌘/Ctrl+W or the pill's × closes one, and closing the last chat
 * hides the whole window (as does the header's close button). Every pane
 * stays mounted while hidden so a familiar can keep streaming a reply in a
 * background tab.
 *
 * Glass: the Rust shell opens this window transparent with OS vibrancy behind
 * it on macOS and appends `?glass=1` — the handshake below flips
 * `html[data-glass]`, which quick-chat-glass.css uses to clear the opaque
 * page background and layer translucency. Other platforms stay opaque.
 */

type TabDescriptor = {
  id: number;
  /** Familiar the tab opens on — inherited from the active tab at creation. */
  initialFamiliarId: string | null;
};

type TabReport = {
  familiar: Familiar | null;
  sessionId: string | null;
  sending: boolean;
};

async function hideTrayWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  } catch {
    // Plain browser (e2e/dev): window.close is a no-op for tabs the script
    // didn't open, which is fine — there is no tray window to hide.
    window.close();
  }
}

export function TrayQuickChat() {
  // Glass handshake — only the Rust shell that actually made the window
  // transparent (macOS vibrancy) sends ?glass=1; a plain browser never gets
  // a translucent background it can't back with a blur.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("glass") === "1") {
      document.documentElement.dataset.glass = "1";
    }
  }, []);

  const seqRef = useRef(2);
  const [tabs, setTabs] = useState<TabDescriptor[]>([{ id: 1, initialFamiliarId: null }]);
  const [activeId, setActiveId] = useState(1);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // Per-tab live state, reported up by each pane (familiar for the pill,
  // sending for the pulse dot, sessionId for the open-in-app hand-off).
  const reportsRef = useRef<Record<number, TabReport>>({});
  const [reports, setReports] = useState<Record<number, TabReport>>({});

  const handleReport = useCallback((id: number, report: TabReport) => {
    reportsRef.current = { ...reportsRef.current, [id]: report };
    setReports(reportsRef.current);
  }, []);

  // A new chat starts on the familiar the user is already talking to — the
  // active tab's current pick — not on a cold default.
  const addTab = useCallback(() => {
    const inherited = reportsRef.current[activeIdRef.current]?.familiar?.id ?? null;
    const id = seqRef.current++;
    setTabs((prev) => [...prev, { id, initialFamiliarId: inherited }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback((id: number) => {
    const prev = tabsRef.current;
    const idx = prev.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    const next = prev.filter((tab) => tab.id !== id);
    const { [id]: dropped, ...rest } = reportsRef.current;
    reportsRef.current = rest;
    setReports(rest);
    if (next.length === 0) {
      // Closing the last chat closes the quick chat itself; a fresh tab
      // (keeping the familiar) waits behind it for the next summon.
      const fresh = { id: seqRef.current++, initialFamiliarId: dropped?.familiar?.id ?? null };
      setTabs([fresh]);
      setActiveId(fresh.id);
      void hideTrayWindow();
      return;
    }
    setTabs(next);
    if (activeIdRef.current === id) {
      setActiveId(next[Math.max(0, idx - 1)]?.id ?? next[0].id);
    }
  }, []);

  // ⌘/Ctrl+N opens a chat, ⌘/Ctrl+W closes the active one. This window owns
  // the whole page, so a global listener can't collide with app surfaces.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        addTab();
      } else if (key === "w") {
        event.preventDefault();
        closeTab(activeIdRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addTab, closeTab]);

  return (
    <main className="tray-quick-chat min-h-screen text-[var(--fg-primary)]">
      <h1 className="sr-only">Quick chat</h1>
      <section className="tray-quick-chat__frame">
        {/* The tray window is created with decorations(false) (see lib.rs), so
            without a drag region it cannot be moved at all. Tauri's injected
            drag.js turns any empty-chrome press in this subtree into a native
            window drag (`deep` semantics; buttons still block it), gated by
            capabilities/loopback-window-drag.json. Inert in plain browsers. */}
        <header className="quick-chat-overlay__header tray-quick-chat__header" data-tauri-drag-region="deep">
          <div role="tablist" aria-label="Quick chats" className="quick-tabs">
            {tabs.map((tab) => {
              const report = reports[tab.id];
              const active = tab.id === activeId;
              const label = report?.familiar?.display_name ?? "New chat";
              return (
                <div key={tab.id} className={`quick-tab${active ? " quick-tab--active" : ""}`}>
                  <button
                    type="button"
                    role="tab"
                    id={`quick-tab-${tab.id}`}
                    aria-selected={active}
                    aria-controls={`quick-tab-panel-${tab.id}`}
                    title={label}
                    className="focus-ring quick-tab__button"
                    onClick={() => setActiveId(tab.id)}
                  >
                    {report?.familiar ? (
                      <FamiliarMark familiar={report.familiar} size="sm" />
                    ) : (
                      <Icon name="ph:chat-circle-dots" width={14} aria-hidden />
                    )}
                    <span className="quick-tab__label">{label}</span>
                    {report?.sending ? (
                      <span className="quick-tab__pulse" role="img" aria-label="Replying…" />
                    ) : null}
                  </button>
                  <IconButton
                    icon="ph:x"
                    size="xs"
                    aria-label={`Close chat with ${label}`}
                    title="Close chat (⌘W)"
                    className="quick-tab__close"
                    onClick={() => closeTab(tab.id)}
                  />
                </div>
              );
            })}
            <IconButton
              icon="ph:plus"
              size="sm"
              aria-label="New chat"
              title="New chat (⌘N)"
              onClick={addTab}
            />
          </div>
          <IconButton
            icon="ph:x"
            size="sm"
            aria-label="Close quick chat"
            title="Close quick chat"
            onClick={() => void hideTrayWindow()}
          />
        </header>

        {tabs.map((tab) => (
          <QuickChatTabPane
            key={tab.id}
            tabId={tab.id}
            active={tab.id === activeId}
            initialFamiliarId={tab.initialFamiliarId}
            onReport={handleReport}
          />
        ))}
      </section>
    </main>
  );
}

// One quick chat. Stays mounted while its tab is in the background — `hidden`
// only hides the DOM, so an in-flight reply keeps streaming behind the
// active tab.
function QuickChatTabPane({
  tabId,
  active,
  initialFamiliarId,
  onReport,
}: {
  tabId: number;
  active: boolean;
  initialFamiliarId: string | null;
  onReport: (id: number, report: TabReport) => void;
}) {
  const {
    familiars,
    selectedFamiliarId,
    setSelectedFamiliarId,
    selectedFamiliar,
    draft,
    setDraft,
    messages,
    error,
    sessionId,
    sendState,
    loading,
    thinkingEffort,
    setThinkingEffort,
    responseSpeed,
    setResponseSpeed,
    send,
    cancel,
    regenerate,
  } = useQuickChat({ preferredFamiliarId: initialFamiliarId });

  const sending = sendState === "sending";
  const { composerRef, pickSuggestion } = useSuggestionPicker(setDraft);

  useEffect(() => {
    onReport(tabId, { familiar: selectedFamiliar, sessionId, sending });
  }, [tabId, onReport, selectedFamiliar, sessionId, sending]);

  // Switching to this tab lands the caret in its composer, mirroring the
  // autoFocus a freshly opened window gets.
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [active, composerRef]);

  const openFullSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("quick-chat:open-session", { sessionId, familiarId: selectedFamiliarId });
    } catch {
      window.location.href = `/#chat-${encodeURIComponent(sessionId)}`;
    }
  }, [selectedFamiliarId, sessionId]);

  return (
    <section
      role="tabpanel"
      id={`quick-tab-panel-${tabId}`}
      aria-labelledby={`quick-tab-${tabId}`}
      hidden={!active}
      className="tray-quick-chat__pane"
    >
      <QuickChatControlsRow
        loading={loading}
        familiars={familiars}
        selectedFamiliarId={selectedFamiliarId}
        onPickFamiliar={setSelectedFamiliarId}
        thinkingEffort={thinkingEffort}
        onThinkingEffortChange={setThinkingEffort}
        responseSpeed={responseSpeed}
        onResponseSpeedChange={setResponseSpeed}
        sending={sending}
      />

      <QuickChatThread
        messages={messages}
        familiar={selectedFamiliar}
        onSuggestion={pickSuggestion}
        onRegenerate={sending ? undefined : regenerate}
      />

      <QuickChatComposer
        error={error}
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => void send()}
        onCancel={cancel}
        sending={sending}
        disabled={loading}
        familiar={selectedFamiliar}
        inputId={`quick-chat-draft-${tabId}`}
        composerRef={composerRef}
        autoFocus={active}
        leading={
          <div className="flex min-w-0 items-center gap-1.5">
            <IconButton
              icon="ph:arrow-square-out"
              size="xs"
              aria-label="Open in CovenCave"
              title="Open in CovenCave"
              disabled={!sessionId}
              onClick={() => void openFullSession()}
            />
            <p className="min-w-0 truncate text-xs text-[var(--fg-muted)]">
              @id switches familiars · ⌘N new chat
            </p>
          </div>
        }
      />
    </section>
  );
}

"use client";

import { useRef, useState } from "react";

import { Icon } from "@/lib/icon";

/** First-party Coven destinations, embedded in-app. */
export const DOCS_URL = "https://docs.opencoven.ai";
export const FEEDBACK_URL = "https://github.com/OpenCoven/coven-cave/issues/new/choose";
export const X_URL = "https://x.com/OpenCvn";

// `embeddable: false` for hosts that refuse framing (github.com sends
// X-Frame-Options: deny + frame-ancestors 'none'; x.com sets frame-ancestors).
// Iframing them just yields a blank pane, so those tabs open in a new tab.
const COVEN_TABS = [
  { id: "docs", label: "Docs", url: DOCS_URL, host: "docs.opencoven.ai", icon: "ph:book-bookmark", embeddable: true },
  { id: "feedback", label: "Feedback", url: FEEDBACK_URL, host: "github.com/OpenCoven", icon: "ph:chat-circle-dots", embeddable: false },
  { id: "x", label: "X", url: X_URL, host: "x.com/OpenCvn", icon: "ph:x-logo-bold", embeddable: false },
] as const;

/**
 * CovenPane embeds Coven-owned web destinations in a dedicated native-feeling
 * browser surface. The iframe sandbox intentionally omits `allow-top-navigation`
 * so framed pages can never navigate the whole app away from itself.
 */
export function CovenPane() {
  const [activeTabId, setActiveTabId] = useState<(typeof COVEN_TABS)[number]["id"]>("docs");
  const [loaded, setLoaded] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const activeTab = COVEN_TABS.find((tab) => tab.id === activeTabId) ?? COVEN_TABS[0];
  const tablistRef = useRef<HTMLDivElement | null>(null);

  function selectTab(id: (typeof COVEN_TABS)[number]["id"]) {
    if (id === activeTabId) return;
    setLoaded(false);
    setActiveTabId(id);
  }

  // APG tablist arrow-key navigation (selection follows focus).
  function onTablistKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = COVEN_TABS.findIndex((tab) => tab.id === activeTabId);
    const ni =
      e.key === "ArrowRight" ? (i + 1) % COVEN_TABS.length
      : e.key === "ArrowLeft" ? (i - 1 + COVEN_TABS.length) % COVEN_TABS.length
      : e.key === "Home" ? 0
      : COVEN_TABS.length - 1;
    const next = COVEN_TABS[ni];
    selectTab(next.id);
    tablistRef.current?.querySelector<HTMLButtonElement>(`#coven-tab-${next.id}`)?.focus();
  }

  function reloadTab() {
    setLoaded(false);
    setReloadNonce((value) => value + 1);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex min-h-[42px] items-center gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-panel)] px-3">
        <Icon name="ph:book-bookmark" width={16} height={16} aria-hidden />
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Coven</span>
        <div
          ref={tablistRef}
          className="ml-2 flex min-w-0 flex-1 items-center gap-1"
          role="tablist"
          aria-label="Coven browser tabs"
          onKeyDown={onTablistKeyDown}
        >
          {COVEN_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`coven-tab-${tab.id}`}
              aria-selected={tab.id === activeTabId}
              aria-controls="coven-tabpanel"
              tabIndex={tab.id === activeTabId ? 0 : -1}
              className={[
                "focus-ring inline-flex h-8 min-w-[88px] items-center justify-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
                tab.id === activeTabId
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_var(--border-hairline)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              ].join(" ")}
              onClick={() => selectTab(tab.id)}
            >
              <Icon name={tab.icon} width={13} height={13} aria-hidden />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-[38px] items-center gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-base)] px-3">
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--accent-presence)]" aria-hidden />
        <span className="truncate text-[12px] text-[var(--text-muted)]">{activeTab.host}</span>
        {activeTab.embeddable ? (
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--sm focus-ring ml-auto"
            onClick={reloadTab}
            title={`Reload ${activeTab.label}`}
            aria-label={`Reload ${activeTab.label}`}
          >
            <Icon name="ph:arrow-clockwise" width={14} height={14} aria-hidden />
            Reload
          </button>
        ) : null}
        <a
          href={activeTab.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`ui-btn ui-btn--ghost ui-btn--sm focus-ring${activeTab.embeddable ? "" : " ml-auto"}`}
        >
          <Icon name="ph:arrow-square-out" width={14} height={14} aria-hidden />
          Open
        </a>
      </div>
      <div
        role="tabpanel"
        id="coven-tabpanel"
        aria-labelledby={`coven-tab-${activeTabId}`}
        className="relative min-h-0 flex-1"
      >
        {activeTab.embeddable ? (
          <>
            {!loaded ? (
              <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-muted)]">
                Loading Coven...
              </div>
            ) : null}
            <iframe
              key={`${activeTab.id}-${reloadNonce}`}
              src={activeTab.url}
              title={`Coven ${activeTab.label}`}
              onLoad={() => setLoaded(true)}
              className="absolute inset-0 h-full w-full border-0 bg-[var(--bg-base)]"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          </>
        ) : (
          // github.com / x.com refuse framing, so embedding would only show a
          // blank pane — present the new-tab escape hatch as the primary action.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Icon name={activeTab.icon} width={30} height={30} className="text-[var(--text-muted)]" aria-hidden />
            <p className="text-[13px] text-[var(--text-primary)]">{activeTab.label} opens in a new tab</p>
            <p className="text-[12px] text-[var(--text-muted)]">{activeTab.host} can&apos;t be embedded here.</p>
            <a
              href={activeTab.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn--primary ui-btn--sm focus-ring"
            >
              <Icon name="ph:arrow-square-out" width={14} height={14} aria-hidden />
              Open {activeTab.label}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

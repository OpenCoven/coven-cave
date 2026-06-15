"use client";

import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { Familiar } from "@/lib/types";

export type CompanionTab = "chat" | "inspector" | "memory" | "browser" | "salem";

type Props = {
  familiar: Familiar | null;
  defaultTab?: CompanionTab;
  activeTab?: CompanionTab;
  chatSlot: ReactNode;
  inspectorSlot: ReactNode;
  memorySlot: ReactNode;
  browserSlot?: ReactNode;
  salemSlot?: ReactNode;
  onOpenSwitcher?: () => void;
  onCreateFamiliar?: () => void;
  daemonRunning: boolean;
  onTabChange?: (tab: CompanionTab) => void;
  /** When the main detail panel is already showing a "pick a familiar"
   * empty state (e.g. the chat surface), set this true so the rail doesn't
   * render a second redundant CTA. */
  suppressEmpty?: boolean;
  hideChatTab?: boolean;
};

// forwardRef handle is wired in Task 2.3; ref is forwarded to the chatSlot consumer.
const CompanionRailInner = forwardRef<ChatRouterHandle, Props>(
  function CompanionRailInner(props, _ref) {
    const {
      familiar,
      defaultTab = "chat",
      activeTab,
      chatSlot,
      inspectorSlot,
      memorySlot,
      browserSlot,
      salemSlot,
      onOpenSwitcher,
      onCreateFamiliar,
      daemonRunning,
      onTabChange,
      suppressEmpty = false,
      hideChatTab = false,
    } = props;
    const resolvedFamiliars = useResolvedFamiliars(familiar ? [familiar] : [], { includeArchived: true });
    const resolvedFamiliar = resolvedFamiliars[0];
    const [tab, setTab] = useState<CompanionTab>(defaultTab);
    const requestedTab = activeTab ?? tab;
    const fallbackTab: CompanionTab = browserSlot ? "browser" : salemSlot ? "salem" : "inspector";
    const selectedTab =
      hideChatTab && requestedTab === "chat"
        ? browserSlot ? "browser" : fallbackTab
        : (requestedTab === "browser" && !browserSlot)
          || (requestedTab === "salem" && !salemSlot)
        ? fallbackTab
        : requestedTab;

    useEffect(() => {
      if (activeTab) setTab(activeTab);
    }, [activeTab]);

    if (!familiar && selectedTab !== "browser") {
      // Skip rendering anything when the main panel already prompts for a
      // familiar — two side-by-side "pick a familiar" CTAs is just noise.
      if (suppressEmpty) return null;
      return (
        <aside className="companion-rail companion-rail--empty">
          <div className="companion-rail__empty-body">
            <p className="companion-rail__empty-title">No familiar yet</p>
            <p className="companion-rail__empty-sub">
              Pick a familiar from the sidebar selector, or create one.
            </p>
            {onCreateFamiliar ? (
              <button
                type="button"
                className="companion-rail__empty-cta"
                onClick={onCreateFamiliar}
              >
                <Icon name="ph:plus-bold" width={11} /> Create familiar
              </button>
            ) : null}
          </div>
        </aside>
      );
    }

    const switchTab = (next: CompanionTab) => {
      setTab(next);
      onTabChange?.(next);
    };

    return (
      <aside className="companion-rail">
        <header className="companion-rail__header">
          <span className="companion-rail__glyph">
            {resolvedFamiliar ? (
              <FamiliarAvatar familiar={resolvedFamiliar} size="sm" />
            ) : (
              <Icon name="ph:globe" width={16} />
            )}
          </span>
          {familiar ? (
            <>
              <button
                type="button"
                className="companion-rail__name"
                onClick={onOpenSwitcher}
                aria-label="Switch familiar"
              >
                <span>{familiar.display_name}</span>
              </button>
              <span
                className={`companion-rail__status${daemonRunning ? "" : " companion-rail__status--off"}`}
                title={daemonRunning ? "Live" : "Daemon offline"}
                aria-hidden
              />
            </>
          ) : (
            <span className="companion-rail__name companion-rail__name--static">
              <span>Browser</span>
            </span>
          )}
        </header>
        <nav className="companion-rail__tabs" aria-label="Companion sections">
          {!familiar || hideChatTab ? null : (
            <button
              type="button"
              className={`companion-rail__tab${selectedTab === "chat" ? " companion-rail__tab--active" : ""}`}
              onClick={() => switchTab("chat")}
              aria-current={selectedTab === "chat"}
              title="Chat"
            >
              <Icon name="ph:chats" width={14} />
            </button>
          )}
          {familiar ? (
            <>
              <button
                type="button"
                className={`companion-rail__tab${selectedTab === "inspector" ? " companion-rail__tab--active" : ""}`}
                onClick={() => switchTab("inspector")}
                aria-current={selectedTab === "inspector"}
                title="Inspector"
              >
                <Icon name="ph:magnifying-glass" width={14} />
              </button>
              <button
                type="button"
                className={`companion-rail__tab${selectedTab === "memory" ? " companion-rail__tab--active" : ""}`}
                onClick={() => switchTab("memory")}
                aria-current={selectedTab === "memory"}
                title="Memory"
              >
                <Icon name="ph:brain" width={14} />
              </button>
            </>
          ) : null}
          {browserSlot ? (
            <button
              type="button"
              className={`companion-rail__tab${selectedTab === "browser" ? " companion-rail__tab--active" : ""}`}
              onClick={() => switchTab("browser")}
              aria-current={selectedTab === "browser"}
              title="Browser"
            >
              <Icon name="ph:globe" width={14} />
            </button>
          ) : null}
          {salemSlot ? (
            <button
              type="button"
              className={`companion-rail__tab${selectedTab === "salem" ? " companion-rail__tab--active" : ""}`}
              onClick={() => switchTab("salem")}
              aria-current={selectedTab === "salem"}
              title="Salem"
            >
              <Icon name="ph:book-open" width={14} />
            </button>
          ) : null}
        </nav>
        <div className="companion-rail__body">
          {!familiar || hideChatTab ? null : (
            <div hidden={selectedTab !== "chat"} className="companion-rail__pane">
              {chatSlot}
            </div>
          )}
          {familiar ? (
            <>
              <div hidden={selectedTab !== "inspector"} className="companion-rail__pane">
                {inspectorSlot}
              </div>
              <div hidden={selectedTab !== "memory"} className="companion-rail__pane">
                {memorySlot}
              </div>
            </>
          ) : null}
          {browserSlot ? (
            <div hidden={selectedTab !== "browser"} className="companion-rail__pane companion-rail__pane--browser">
              {selectedTab === "browser" ? browserSlot : null}
            </div>
          ) : null}
          {salemSlot ? (
            <div hidden={selectedTab !== "salem"} className="companion-rail__pane">
              {selectedTab === "salem" ? salemSlot : null}
            </div>
          ) : null}
        </div>
      </aside>
    );
  },
);

/** Public export — wraps CompanionRailInner; ref forwarding wired in Task 2.3. */
export function CompanionRail(
  props: Props & { ref?: React.Ref<ChatRouterHandle> },
) {
  const { ref, ...rest } = props;
  return <CompanionRailInner {...rest} ref={ref} />;
}

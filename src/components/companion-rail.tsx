"use client";

import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { Familiar } from "@/lib/types";

export type CompanionTab = "chat" | "inspector" | "memory" | "salem";

type Props = {
  familiar: Familiar | null;
  defaultTab?: CompanionTab;
  activeTab?: CompanionTab;
  chatSlot: ReactNode;
  inspectorSlot: ReactNode;
  memorySlot: ReactNode;
  salemSlot?: ReactNode;
  onOpenSwitcher?: () => void;
  onCreateFamiliar?: () => void;
  daemonRunning: boolean;
  onTabChange?: (tab: CompanionTab) => void;
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
      salemSlot,
      onOpenSwitcher,
      onCreateFamiliar,
      daemonRunning,
      onTabChange,
    } = props;
    const resolvedFamiliars = useResolvedFamiliars(familiar ? [familiar] : [], { includeArchived: true });
    const resolvedFamiliar = resolvedFamiliars[0];
    const [tab, setTab] = useState<CompanionTab>(defaultTab);
    const selectedTab = activeTab ?? tab;

    useEffect(() => {
      if (activeTab) setTab(activeTab);
    }, [activeTab]);

    if (!familiar) {
      return (
        <aside className="companion-rail companion-rail--empty">
          <div className="companion-rail__empty-body">
            <p className="companion-rail__empty-title">No familiar yet</p>
            <p className="companion-rail__empty-sub">
              Pick a familiar from the rail on the left, or create one.
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
            ) : null}
          </span>
          <button
            type="button"
            className="companion-rail__name"
            onClick={onOpenSwitcher}
            aria-label="Switch familiar"
          >
            <span>{familiar.display_name}</span>
            <Icon name="ph:caret-down" width={10} />
          </button>
          <span
            className={`companion-rail__status${daemonRunning ? "" : " companion-rail__status--off"}`}
            title={daemonRunning ? "Live" : "Daemon offline"}
            aria-hidden
          />
        </header>
        <nav className="companion-rail__tabs" aria-label="Companion sections">
          <button
            type="button"
            className={`companion-rail__tab${selectedTab === "chat" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("chat")}
            aria-current={selectedTab === "chat"}
          >
            <Icon name="ph:chats" width={11} /> Chat
          </button>
          <button
            type="button"
            className={`companion-rail__tab${selectedTab === "inspector" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("inspector")}
            aria-current={selectedTab === "inspector"}
          >
            <Icon name="ph:magnifying-glass" width={11} /> Inspector
          </button>
          <button
            type="button"
            className={`companion-rail__tab${selectedTab === "memory" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("memory")}
            aria-current={selectedTab === "memory"}
          >
            <Icon name="ph:brain" width={11} /> Memory
          </button>
          {salemSlot ? (
            <button
              type="button"
              className={`companion-rail__tab${selectedTab === "salem" ? " companion-rail__tab--active" : ""}`}
              onClick={() => switchTab("salem")}
              aria-current={selectedTab === "salem"}
            >
              <Icon name="ph:book-open" width={11} /> Salem
            </button>
          ) : null}
        </nav>
        <div className="companion-rail__body">
          <div hidden={selectedTab !== "chat"} className="companion-rail__pane">
            {chatSlot}
          </div>
          <div hidden={selectedTab !== "inspector"} className="companion-rail__pane">
            {inspectorSlot}
          </div>
          <div hidden={selectedTab !== "memory"} className="companion-rail__pane">
            {memorySlot}
          </div>
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

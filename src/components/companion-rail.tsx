"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { Familiar } from "@/lib/types";

export type CompanionTab = "chat" | "inspector" | "memory";

type Props = {
  familiar: Familiar | null;
  defaultTab?: CompanionTab;
  chatSlot: ReactNode;
  inspectorSlot: ReactNode;
  memorySlot: ReactNode;
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
      chatSlot,
      inspectorSlot,
      memorySlot,
      onOpenSwitcher,
      onCreateFamiliar,
      daemonRunning,
      onTabChange,
    } = props;
    const resolvedFamiliars = useResolvedFamiliars(familiar ? [familiar] : [], { includeArchived: true });
    const resolvedFamiliar = resolvedFamiliars[0];
    const [tab, setTab] = useState<CompanionTab>(defaultTab);

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
            className={`companion-rail__tab${tab === "chat" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("chat")}
            aria-current={tab === "chat"}
          >
            <Icon name="ph:chats" width={11} /> Chat
          </button>
          <button
            type="button"
            className={`companion-rail__tab${tab === "inspector" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("inspector")}
            aria-current={tab === "inspector"}
          >
            <Icon name="ph:magnifying-glass" width={11} /> Inspector
          </button>
          <button
            type="button"
            className={`companion-rail__tab${tab === "memory" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("memory")}
            aria-current={tab === "memory"}
          >
            <Icon name="ph:brain" width={11} /> Memory
          </button>
        </nav>
        <div className="companion-rail__body">
          <div hidden={tab !== "chat"} className="companion-rail__pane">
            {chatSlot}
          </div>
          <div hidden={tab !== "inspector"} className="companion-rail__pane">
            {inspectorSlot}
          </div>
          <div hidden={tab !== "memory"} className="companion-rail__pane">
            {memorySlot}
          </div>
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

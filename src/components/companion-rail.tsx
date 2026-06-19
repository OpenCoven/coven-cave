"use client";

import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Icon } from "@/lib/icon";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { YoutubeViewer } from "@/components/youtube-viewer";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { Familiar } from "@/lib/types";

export type CompanionTab = "chat" | "memory" | "browser" | "salem";

type Props = {
  familiar: Familiar | null;
  defaultTab?: CompanionTab;
  activeTab?: CompanionTab;
  chatSlot: ReactNode;
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
      memorySlot,
      browserSlot,
      salemSlot,
      onCreateFamiliar,
      onTabChange,
      suppressEmpty = false,
      hideChatTab = false,
    } = props;
    const [tab, setTab] = useState<CompanionTab>(defaultTab);
    // The Video tab is a toggle, not a mutually-exclusive section: when on, the
    // YouTube viewer drops into a resizable bottom pane below the active tab's
    // content rather than replacing it.
    const [youtubeOpen, setYoutubeOpen] = useState(false);
    const requestedTab = activeTab ?? tab;
    const fallbackTab: CompanionTab = browserSlot ? "browser" : salemSlot ? "salem" : "memory";
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

    // The active tab's content. Rendered once; either fills the body or sits in
    // the top pane of the split when the Video toggle is on.
    const panes = (
      <>
        {!familiar || hideChatTab ? null : (
          <div hidden={selectedTab !== "chat"} className="companion-rail__pane">
            {chatSlot}
          </div>
        )}
        {familiar ? (
          <div hidden={selectedTab !== "memory"} className="companion-rail__pane">
            {memorySlot}
          </div>
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
      </>
    );

    return (
      <aside className="companion-rail">
        {/* Familiar header removed — the tab strip is the panel's top row and
            its trigger band aligns with the left sidebar's floating toggle. */}
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
            <button
              type="button"
              className={`companion-rail__tab${selectedTab === "memory" ? " companion-rail__tab--active" : ""}`}
              onClick={() => switchTab("memory")}
              aria-current={selectedTab === "memory"}
              title="Memory"
            >
              <Icon name="ph:brain" width={14} />
            </button>
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
          <button
            type="button"
            className={`companion-rail__tab${youtubeOpen ? " companion-rail__tab--active" : ""}`}
            onClick={() => setYoutubeOpen((open) => !open)}
            aria-pressed={youtubeOpen}
            title="Video"
          >
            <Icon name="ph:video" width={14} />
          </button>
        </nav>
        <div className="companion-rail__body">
          {youtubeOpen ? (
            <Group orientation="vertical" className="companion-rail__split">
              <Panel
                id="companion-rail-main"
                minSize={20}
                defaultSize={58}
                className="companion-rail__split-pane"
              >
                {panes}
              </Panel>
              <Separator className="companion-rail__resize shrink-0" data-orientation="row">
                <SeparatorHandle orientation="row" />
              </Separator>
              <Panel
                id="companion-rail-youtube"
                minSize={20}
                defaultSize={42}
                className="companion-rail__split-pane"
              >
                <YoutubeViewer />
              </Panel>
            </Group>
          ) : (
            panes
          )}
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

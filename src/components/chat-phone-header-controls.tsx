"use client";

import { createContext, useContext } from "react";
import { Icon } from "@/lib/icon";

/**
 * Phone chat chrome (#5529). While a thread is open on a phone, the chat
 * section tabs strip is folded away so the transcript gets the height. The
 * two controls that lived in that strip for an open thread — the route to the
 * chat list and the code-rail toggle — move into the chat header. ChatSurface
 * owns both pieces of state and provides them here, so ChatView can render
 * them without threading props through ChatRouter.
 */
export type ChatPhoneHeaderControlsValue = {
  threads: { open: boolean; onOpen: () => void } | null;
  codeRail: { open: boolean; changeCount: number; onToggle: () => void } | null;
};

export const ChatPhoneHeaderControlsContext = createContext<ChatPhoneHeaderControlsValue | null>(null);

/** The chat-list toggle for the phone chat header. Hidden above the phone
 *  breakpoint by CSS, where the section tabs strip keeps its own toggle. */
export function ChatPhoneThreadsToggle() {
  const threads = useContext(ChatPhoneHeaderControlsContext)?.threads;
  if (!threads) return null;
  return (
    <button
      type="button"
      className="cave-mobile-header-threads focus-ring"
      aria-label="Show chat list"
      aria-haspopup="dialog"
      aria-expanded={threads.open}
      onClick={threads.onOpen}
    >
      <Icon name="ph:sidebar-simple" width={16} aria-hidden />
    </button>
  );
}

/** The code-rail toggle for the phone chat header. */
export function ChatPhoneCodeRailToggle() {
  const codeRail = useContext(ChatPhoneHeaderControlsContext)?.codeRail;
  if (!codeRail) return null;
  return (
    <button
      type="button"
      className="cave-mobile-header-code-rail mobile-code-rail-toggle focus-ring"
      aria-label={codeRail.open ? "Hide code rail" : "Show code rail"}
      aria-haspopup="dialog"
      aria-expanded={codeRail.open}
      onClick={codeRail.onToggle}
    >
      <Icon name="ph:code" width={16} aria-hidden />
      {codeRail.changeCount > 0 ? (
        <span className="mobile-code-rail-toggle__badge">{codeRail.changeCount}</span>
      ) : null}
    </button>
  );
}

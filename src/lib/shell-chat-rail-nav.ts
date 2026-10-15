/**
 * When the open nav gives way to Chat's thread list (#5956, G2).
 *
 * Chat sets prose in a capped reading column (72ch, 752px). On a wide window
 * the nav and the chat list cost that column nothing; closing the nav only
 * widens the wallpaper margin. On a narrow desktop window the same 240px nav
 * squeezes it, measured with the list open:
 *
 *   window   nav open   nav closed
 *   1024px   328px      540px
 *   1280px   546px      752px
 *   1440px   706px      752px
 *   1920px   752px      752px
 *
 * At 1280px the column still sets about 52 characters a line, inside the
 * readable 45–75 range, so the nav stays. Below about 1200px it drops under
 * 45 (31 at 1024px). There the nav yields for the visit, the way it already
 * yields to the right Chat panel (`shouldAutoCollapseNavForRightChat`) and the
 * Coding Desk rail.
 * It is not an icon rail (#4747, #4936) and not a collapse on every Chat visit
 * (the retired `visit-collapsed` policy): wide windows keep the nav the user
 * left open.
 *
 * Pure module so the policy is unit-testable without a shell.
 */

import type { ChatRailVisibility } from "./chat-rail-toggle.ts";

/** Narrowest window-minus-nav-minus-list width that still sets prose at 45
 *  characters a line (about 470px of the 752px column, after the pane's own
 *  chrome and padding). Below it the open nav yields to the chat list. With the
 *  default 240px nav and 280px list that is a window under 1200px. */
export const CHAT_CONVERSATION_MIN_PX = 680;

export interface ChatRailNavFitInput {
  viewportWidth: number;
  /** The nav's open width (its expansion target, not its current size). */
  navWidth: number;
  /** The chat list's rendered width; 0 when it is not on screen. */
  railWidth: number;
}

export function shouldNavYieldToChatRail({
  viewportWidth,
  navWidth,
  railWidth,
}: ChatRailNavFitInput): boolean {
  if (!(navWidth > 0) || !(railWidth > 0)) return false;
  return viewportWidth - navWidth - railWidth < CHAT_CONVERSATION_MIN_PX;
}

/** One Chat visit's bookkeeping. A visit starts when the list is first seen
 *  and ends when the list is collapsed or Chat is left. */
export type ChatRailNavState = {
  /** The list has been seen this visit, so the fit was already decided. */
  visited: boolean;
  /** The shell closed the nav for this visit and owes it back. */
  autoCollapsed: boolean;
  /** The user reopened the nav during this visit; leave it alone until the
   *  visit ends. */
  userOverrode: boolean;
};

export const CHAT_RAIL_NAV_IDLE: ChatRailNavState = Object.freeze({
  visited: false,
  autoCollapsed: false,
  userOverrode: false,
});

export type ChatRailNavStep = {
  action: "collapse" | "restore" | "none";
  state: ChatRailNavState;
};

/**
 * What the shell does with the nav when the chat list's visibility changes.
 *
 * - First sight of the list this visit, nav open, and the two don't fit:
 *   collapse. Later announcements in the same visit (a tab switch back, a nav
 *   the user opened and dragged wider) never move the nav again.
 * - List collapsed by the user, or Chat left (ChatSurface retracts with
 *   `{ available: false, open: false }`): give the nav back unless the user
 *   reopened it, and end the visit.
 * - Projects or Familiar tab (`{ available: false, open: true }`): the list is
 *   only out of view, so the visit continues and the nav stays as it is.
 *   Restoring there would make every tab switch move the sidebar.
 */
export function resolveChatRailNavYield({
  rail,
  isMobile,
  navOpen,
  yieldNeeded,
  state,
}: {
  rail: ChatRailVisibility;
  isMobile: boolean;
  navOpen: boolean;
  yieldNeeded: boolean;
  state: ChatRailNavState;
}): ChatRailNavStep {
  // The phone nav is a drawer; it never shares a row with the list.
  if (isMobile) return { action: "none", state: CHAT_RAIL_NAV_IDLE };
  if (!rail.open) {
    const owed = state.autoCollapsed && !state.userOverrode;
    return { action: owed ? "restore" : "none", state: CHAT_RAIL_NAV_IDLE };
  }
  if (!rail.available || state.visited) return { action: "none", state };
  if (navOpen && yieldNeeded) {
    return { action: "collapse", state: { visited: true, autoCollapsed: true, userOverrode: false } };
  }
  return { action: "none", state: { ...state, visited: true } };
}

/** The nav opened while the shell held it closed: that was the user. */
export function noteChatRailNavOpened(state: ChatRailNavState): ChatRailNavState {
  if (!state.autoCollapsed) return state;
  return { ...state, autoCollapsed: false, userOverrode: true };
}

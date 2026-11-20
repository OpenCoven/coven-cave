import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_CONVERSATION_MIN_PX,
  CHAT_RAIL_NAV_IDLE,
  noteChatRailNavOpened,
  resolveChatRailNavYield,
  shouldNavYieldToChatRail,
} from "./shell-chat-rail-nav.ts";

const NAV = 240;
const RAIL = 280;

test("the nav yields only where it squeezes the reading column", () => {
  // Measured anchors from #5956: at 1024 the open nav leaves ~31 characters a
  // line; at 1280 ~52 (readable); 1440 loses 46px; 1920 and up lose nothing.
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1024, navWidth: NAV, railWidth: RAIL }), true);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1100, navWidth: NAV, railWidth: RAIL }), true);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1280, navWidth: NAV, railWidth: RAIL }), false);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1440, navWidth: NAV, railWidth: RAIL }), false);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1920, navWidth: NAV, railWidth: RAIL }), false);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 3828, navWidth: NAV, railWidth: RAIL }), false);
});

test("the boundary is the conversation minimum, not a window breakpoint", () => {
  const edge = NAV + RAIL + CHAT_CONVERSATION_MIN_PX;
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: edge, navWidth: NAV, railWidth: RAIL }), false);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: edge - 1, navWidth: NAV, railWidth: RAIL }), true);
  // A wider list or nav moves the boundary with it.
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1280, navWidth: NAV, railWidth: 440 }), true);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1280, navWidth: 420, railWidth: RAIL }), true);
});

test("no list or no nav on screen means nothing to yield", () => {
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1024, navWidth: NAV, railWidth: 0 }), false);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1024, navWidth: 0, railWidth: RAIL }), false);
  assert.equal(shouldNavYieldToChatRail({ viewportWidth: 1024, navWidth: Number.NaN, railWidth: RAIL }), false);
});

const listOpen = { available: true, open: true };
const otherTab = { available: false, open: true };
const listClosed = { available: true, open: false };
const leftChat = { available: false, open: false };
const base = { isMobile: false, navOpen: true, yieldNeeded: true, state: CHAT_RAIL_NAV_IDLE };

test("entering Chat on a narrow window closes the open nav once", () => {
  const step = resolveChatRailNavYield({ ...base, rail: listOpen });
  assert.equal(step.action, "collapse");
  assert.deepEqual(step.state, { visited: true, autoCollapsed: true, userOverrode: false });
  // A second announcement in the same visit does not collapse again.
  assert.equal(resolveChatRailNavYield({ ...base, rail: listOpen, state: step.state }).action, "none");
});

test("a wide window, a closed nav, or a phone leaves the nav alone", () => {
  assert.equal(resolveChatRailNavYield({ ...base, rail: listOpen, yieldNeeded: false }).action, "none");
  const closed = resolveChatRailNavYield({ ...base, rail: listOpen, navOpen: false });
  assert.equal(closed.action, "none");
  assert.equal(closed.state.visited, true);
  const phone = resolveChatRailNavYield({ ...base, rail: listOpen, isMobile: true });
  assert.equal(phone.action, "none");
  assert.deepEqual(phone.state, CHAT_RAIL_NAV_IDLE);
});

test("leaving Chat or collapsing the list gives the nav back and ends the visit", () => {
  const held = { visited: true, autoCollapsed: true, userOverrode: false };
  for (const rail of [leftChat, listClosed]) {
    const step = resolveChatRailNavYield({ ...base, rail, navOpen: false, state: held });
    assert.equal(step.action, "restore", JSON.stringify(rail));
    assert.deepEqual(step.state, CHAT_RAIL_NAV_IDLE);
  }
  // Nothing owed: nothing restored.
  assert.equal(resolveChatRailNavYield({ ...base, rail: leftChat }).action, "none");
});

test("switching to Projects or Familiar keeps the visit and the sidebar where they are", () => {
  const held = { visited: true, autoCollapsed: true, userOverrode: false };
  const step = resolveChatRailNavYield({ ...base, rail: otherTab, navOpen: false, state: held });
  assert.equal(step.action, "none");
  assert.deepEqual(step.state, held);
  // Back on the conversation tab the nav is already closed: no second move.
  assert.equal(resolveChatRailNavYield({ ...base, rail: listOpen, navOpen: false, state: step.state }).action, "none");
});

test("reopening the nav wins for the rest of the visit", () => {
  const overrode = noteChatRailNavOpened({ visited: true, autoCollapsed: true, userOverrode: false });
  assert.deepEqual(overrode, { visited: true, autoCollapsed: false, userOverrode: true });
  // Still cramped, still open: the shell does not take it away again.
  assert.equal(resolveChatRailNavYield({ ...base, rail: listOpen, state: overrode }).action, "none");
  // Leaving Chat owes nothing back, and the next visit starts fresh.
  const left = resolveChatRailNavYield({ ...base, rail: leftChat, state: overrode });
  assert.equal(left.action, "none");
  assert.deepEqual(left.state, CHAT_RAIL_NAV_IDLE);
  assert.equal(resolveChatRailNavYield({ ...base, rail: listOpen, state: left.state }).action, "collapse");
});

test("an open nav the shell did not close is not an override", () => {
  assert.equal(noteChatRailNavOpened(CHAT_RAIL_NAV_IDLE), CHAT_RAIL_NAV_IDLE);
});

test("a visit looks once: a nav opened by hand on Chat survives tab switches and drags", () => {
  // Entered with the nav closed, so nothing was owed and nothing taken.
  const entered = resolveChatRailNavYield({ ...base, rail: listOpen, navOpen: false });
  assert.equal(entered.action, "none");
  // The user opens the nav (not an override: the shell never closed it), then
  // switches Projects -> Chats or drags it wider. Still cramped, still theirs.
  const opened = noteChatRailNavOpened(entered.state);
  const away = resolveChatRailNavYield({ ...base, rail: otherTab, state: opened });
  assert.equal(resolveChatRailNavYield({ ...base, rail: listOpen, state: away.state }).action, "none");
  // Collapsing and reopening the list starts a new visit, which looks again.
  const ended = resolveChatRailNavYield({ ...base, rail: listClosed, state: away.state });
  assert.equal(ended.action, "none");
  assert.equal(resolveChatRailNavYield({ ...base, rail: listOpen, state: ended.state }).action, "collapse");
});

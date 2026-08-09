import assert from "node:assert/strict";
import test from "node:test";
import {
  RIGHT_CHAT_DEFAULT_PX,
  RIGHT_CHAT_MAX_PX,
  RIGHT_CHAT_MIN_PX,
  normalizeRightChatOpen,
  normalizeRightChatWidth,
  shouldAutoCollapseNavForRightChat,
} from "./shell-right-chat.ts";

test("normalizes corrupt open preference to closed", () => {
  assert.equal(normalizeRightChatOpen("1"), true);
  assert.equal(normalizeRightChatOpen("0"), false);
  assert.equal(normalizeRightChatOpen("yes"), false);
  assert.equal(normalizeRightChatOpen(null), false);
});

test("normalizes width fallback and clamping", () => {
  assert.equal(normalizeRightChatWidth(null), RIGHT_CHAT_DEFAULT_PX);
  assert.equal(normalizeRightChatWidth("nope"), RIGHT_CHAT_DEFAULT_PX);
  assert.equal(normalizeRightChatWidth("200"), RIGHT_CHAT_MIN_PX);
  assert.equal(normalizeRightChatWidth("900"), RIGHT_CHAT_MAX_PX);
  assert.equal(normalizeRightChatWidth("480"), 480);
});

test("auto-collapses only when nav plus chat plus detail cannot fit", () => {
  assert.equal(
    shouldAutoCollapseNavForRightChat({
      viewportWidth: 1180,
      navWidth: 240,
      rightChatWidth: 640,
    }),
    true,
  );
  assert.equal(
    shouldAutoCollapseNavForRightChat({
      viewportWidth: 1440,
      navWidth: 240,
      rightChatWidth: 640,
    }),
    false,
  );
  assert.equal(
    shouldAutoCollapseNavForRightChat({
      viewportWidth: 1024,
      navWidth: 56,
      rightChatWidth: 360,
    }),
    false,
  );
});

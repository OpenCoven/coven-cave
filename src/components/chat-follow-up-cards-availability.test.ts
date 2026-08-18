// @ts-nocheck
// Behavioral coverage for the presentation-only "Save link" availability
// state (cave-onpeg): FollowUpCards must expose a truthful aria-disabled
// state from a caller-supplied boolean, WITHOUT ever parsing source text or
// gating onClick — that stays ChatView's job (see chat-follow-up-cards.tsx
// and chat-view.tsx for the routing/announcement side of this contract).
import { describe, test, expect } from "vitest";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { FollowUpCards } from "./chat-follow-up-cards.tsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const savePath = {
  kind: "action",
  actionId: "save-link",
  label: "Save this link",
  prompt: "save-link",
  recommended: false,
};

const recommendedSavePath = { ...savePath, recommended: true };

const replyPath = {
  kind: "reply",
  label: "Ask a follow-up",
  prompt: "tell me more",
  recommended: true,
};

const openTasksPath = {
  kind: "action",
  actionId: "open-tasks",
  label: "Open Tasks",
  prompt: "open-tasks",
  recommended: false,
};

function renderCards(paths, saveLinkAvailable, onActivate) {
  let root;
  act(() => {
    root = create(createElement(FollowUpCards, { paths, onActivate, saveLinkAvailable }));
  });
  return root;
}

test("a save-link card is truthfully aria-disabled when the caller reports no links on its exact source turn, but stays focusable and clickable", () => {
  const activated = [];
  const root = renderCards([savePath], false, (path) => activated.push(path));
  const button = root.root.findByType("button");

  expect(button.props["aria-disabled"]).toBe(true);
  expect(button.props.disabled).toBeUndefined();
  expect(button.props["aria-label"]).toMatch(
    /No links available to save\.$/,
  );

  act(() => {
    button.props.onClick();
  });
  expect(activated).toEqual([savePath]);
});

test("a save-link card reports available when the caller's exact source turn has links, even though it's not part of this component's own logic", () => {
  const root = renderCards([savePath], true, () => {});
  const button = root.root.findByType("button");

  expect(button.props["aria-disabled"]).toBeUndefined();
  expect(button.props["aria-label"]).not.toMatch(/No links available to save/);
});

test("recommendation never grants authority: a recommended-but-unavailable save-link card still reports unavailable", () => {
  const root = renderCards([recommendedSavePath], false, () => {});
  const button = root.root.findByType("button");

  expect(button.props["aria-disabled"]).toBe(true);
  expect(button.props["aria-label"]).toMatch(/Recommended\. No links available to save\.$/);
});

test("saveLinkAvailable never affects non-save-link paths", () => {
  const replyRoot = renderCards([replyPath], false, () => {});
  expect(replyRoot.root.findByType("button").props["aria-disabled"]).toBeUndefined();

  const tasksRoot = renderCards([openTasksPath], false, () => {});
  expect(tasksRoot.root.findByType("button").props["aria-disabled"]).toBeUndefined();
});

test("omitting saveLinkAvailable treats a save-link card as available — callers with no save-link path need no wiring", () => {
  const root = renderCards([savePath], undefined, () => {});
  const button = root.root.findByType("button");
  expect(button.props["aria-disabled"]).toBeUndefined();
});

console.log("chat-follow-up-cards-availability.test.ts: ok");

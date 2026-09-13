// @ts-nocheck
import React from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { ChatChapterNavigator } from "./chat-chapter-navigator";
import { buildChatContinuityChapters } from "@/lib/chat-continuity-chapters";

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, children, onClose }) => open ? <div role="dialog"><button onClick={onClose}>Close</button>{children}</div> : null,
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const index = buildChatContinuityChapters("exact", [{ id: "first", createdAt: "2026-09-08T00:00:00Z" }, { id: "second", createdAt: "2026-09-09T00:00:00Z" }], true);
test("controlled navigator reveals exact anchor and labels partial loaded-only scope", async () => {
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  let renderer;
  await act(async () => { renderer = create(<ChatChapterNavigator index={index} open selectedId={null} onSelect={onSelect} onOpenChange={onOpenChange} />); });
  expect(JSON.stringify(renderer.toJSON())).toContain("Partial index");
  const row = renderer.root.findAllByType("button").find((b) => b.props["data-chapter-id"] === index.chapters[0].id);
  await act(async () => row.props.onClick());
  expect(onSelect).toHaveBeenCalledWith(index.chapters[0]);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  await act(async () => renderer.unmount());
});
test("removed selection and switching conversations never select a replacement", async () => {
  const onSelect = vi.fn();
  let renderer;
  const props = { open: true, selectedId: index.chapters[0].id, onSelect, onOpenChange: vi.fn() };
  await act(async () => { renderer = create(<ChatChapterNavigator {...props} index={index} />); });
  const switched = buildChatContinuityChapters("other", [{ id: "first", createdAt: "2026-09-08T00:00:00Z" }], true);
  await act(async () => renderer.update(<ChatChapterNavigator {...props} index={switched} />));
  expect(onSelect).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType("button").some((b) => b.props["aria-current"] === "location")).toBe(false);
  await act(async () => renderer.update(<ChatChapterNavigator {...props} index={buildChatContinuityChapters("other", [], true)} />));
  expect(JSON.stringify(renderer.toJSON())).toContain("Chapter index unavailable");
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test("unrestorable location is a visible controlled status, not a deletion claim or replacement selection", async () => {
  const onSelect = vi.fn();
  const props = { open: false, selectedId: null, onSelect, onOpenChange: vi.fn(), locationUnavailable: true };
  let renderer;
  await act(async () => { renderer = create(<ChatChapterNavigator {...props} index={index} />); });
  expect(renderer.root.findByProps({ role: "status" }).children.join(""))
    .toBe("Saved location unavailable in the current history. You're still in the same chat.");
  await act(async () => renderer.update(<ChatChapterNavigator {...props} open index={index} />));
  expect(renderer.root.findAllByType("button").some((button) => button.props["aria-current"] === "location")).toBe(false);
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => renderer.update(<ChatChapterNavigator {...props} index={buildChatContinuityChapters("exact", [], true)} />));
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain("current history");
  expect(JSON.stringify(renderer.toJSON())).not.toMatch(/deleted|removed/);
  await act(async () => renderer.update(<ChatChapterNavigator {...props} locationUnavailable={false} index={index} />));
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test("100k-turn window controls disclose the bounded loaded range and dispatch only explicit navigation", async () => {
  const window = { start: 970, end: 1030, total: 100_000, atLatest: false, onEarlier: vi.fn(), onLater: vi.fn(), onLatest: vi.fn() };
  let renderer;
  const props = { index, open: false, selectedId: null, onSelect: vi.fn(), onOpenChange: vi.fn() };
  await act(async () => { renderer = create(<ChatChapterNavigator {...props} window={window} />); });
  const nav = renderer.root.findByProps({ "aria-label": "Loaded transcript window" });
  expect(nav.findByType("span").children.join("")).toBe("Turns 971–1030 of 100000 loaded");
  const buttons = nav.findAllByType("button");
  expect(buttons).toHaveLength(3);
  expect(window.onEarlier).not.toHaveBeenCalled();
  await act(async () => buttons.forEach((button) => button.props.onClick()));
  expect(window.onEarlier).toHaveBeenCalledTimes(1);
  expect(window.onLater).toHaveBeenCalledTimes(1);
  expect(window.onLatest).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(<ChatChapterNavigator {...props} window={{ ...window, start: 99_940, end: 100_000, atLatest: true }} />));
  const latestButtons = renderer.root.findByProps({ "aria-label": "Loaded transcript window" }).findAllByType("button");
  expect(latestButtons[1].props.disabled).toBe(true);
  expect(latestButtons[2].props.disabled).toBe(true);
  await act(async () => renderer.unmount());
});

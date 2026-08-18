// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce: mocks.announce }),
}));
vi.mock("@/components/ui/button", async () => {
  const { createElement } = await import("react");
  return {
    Button: ({ children, loading: _loading, ...props }) =>
      createElement("button", props, children),
  };
});
vi.mock("@/components/ui/modal", async () => {
  const { createElement } = await import("react");
  return {
    Modal: ({ open, onClose, children, footerActions, ...props }) => open
      ? createElement(
          "div",
          { "data-testid": "follow-up-link-modal", ...props },
          createElement("button", { "aria-label": "Close", onClick: onClose }),
          children,
          footerActions,
        )
      : null,
  };
});
vi.mock("@/lib/chat-follow-up-links", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, saveFollowUpLinks: mocks.save };
});

import { FollowUpLinkReview } from "./chat-follow-up-link-review";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const task = { id: "task-1", title: "Ship follow-ups" };

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object" && "children" in node) {
    return text((node as { children: unknown }).children);
  }
  return "";
}

function controls(renderer: ReactTestRenderer, type: "checkbox" | "radio") {
  return renderer.root.findAll(
    (node) => node.type === "input" && node.props.type === type,
  );
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "button" && text(node.children) === label,
  );
}

async function renderReview(overrides = {}) {
  const props = {
    open: true,
    links: ["https://one.dev", "https://two.dev"],
    task,
    reviewIdentity: {},
    onClose: vi.fn(),
    ...overrides,
  };
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(FollowUpLinkReview, props));
  });
  return { renderer, props };
}

beforeEach(() => {
  mocks.announce.mockReset();
  mocks.save.mockReset();
});

test("selects every valid link and resets selection and destination on open or new links", async () => {
  const { renderer, props } = await renderReview({ open: false });
  expect(renderer.toJSON()).toBeNull();

  await act(async () => {
    renderer.update(createElement(FollowUpLinkReview, { ...props, open: true }));
  });
  expect(controls(renderer, "checkbox").map((node) => node.props.checked)).toEqual([true, true]);

  await act(async () => controls(renderer, "checkbox")[0].props.onChange());
  await act(async () => controls(renderer, "radio")[1].props.onChange());
  expect(controls(renderer, "radio")[1].props.checked).toBe(true);

  await act(async () => {
    renderer.update(createElement(FollowUpLinkReview, {
      ...props,
      open: true,
      links: ["https://three.dev"],
    }));
  });
  expect(controls(renderer, "checkbox").map((node) => node.props.checked)).toEqual([true]);
  expect(controls(renderer, "radio")[0].props.checked).toBe(true);
});

test("deselecting the final link uses only the visible alert and blocks submit", async () => {
  const { renderer } = await renderReview({ links: ["https://one.dev"] });

  await act(async () => controls(renderer, "checkbox")[0].props.onChange());
  expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
    "No links available to save",
  ]);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  expect(mocks.announce).not.toHaveBeenCalled();
  expect(button(renderer, "Save links").props.disabled).toBe(true);

  await act(async () => button(renderer, "Save links").props.onClick());
  expect(mocks.save).not.toHaveBeenCalled();

  await act(async () => controls(renderer, "checkbox")[0].props.onChange());
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(button(renderer, "Save links").props.disabled).toBe(false);
});

test("Cancel and Modal close never persist links", async () => {
  const onClose = vi.fn();
  const { renderer } = await renderReview({ onClose });

  await act(async () => button(renderer, "Cancel").props.onClick());
  await act(async () => renderer.root.findByProps({ "aria-label": "Close" }).props.onClick());

  expect(onClose).toHaveBeenCalledTimes(2);
  expect(mocks.save).not.toHaveBeenCalled();
});

test("failed save preserves retry state and uses only the visible error alert", async () => {
  mocks.save.mockResolvedValue({ ok: false, error: "Board is unavailable." });
  const { renderer, props } = await renderReview({ links: ["https://one.dev"] });
  await act(async () => controls(renderer, "radio")[1].props.onChange());

  await act(async () => button(renderer, "Attach links").props.onClick());

  expect(mocks.save).toHaveBeenCalledWith({
    destination: "task",
    taskId: task.id,
    urls: ["https://one.dev"],
  });
  expect(controls(renderer, "checkbox").map((node) => node.props.checked)).toEqual([true]);
  expect(controls(renderer, "radio")[1].props.checked).toBe(true);
  expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
    "Board is unavailable.",
  ]);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  expect(mocks.announce).not.toHaveBeenCalled();
  expect(button(renderer, "Attach links").props.disabled).toBe(false);
  expect(props.onClose).not.toHaveBeenCalled();
});

test("selection changes clear stale server errors and retain only the empty-selection error", async () => {
  mocks.save.mockResolvedValue({ ok: false, error: "Board is unavailable." });
  const { renderer } = await renderReview();

  await act(async () => button(renderer, "Save links").props.onClick());
  expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
    "Board is unavailable.",
  ]);

  await act(async () => controls(renderer, "checkbox")[0].props.onChange());
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);

  await act(async () => controls(renderer, "checkbox")[1].props.onChange());
  expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
    "No links available to save",
  ]);
  await act(async () => controls(renderer, "checkbox")[0].props.onChange());
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(mocks.announce).not.toHaveBeenCalled();
});

test("successful save announces before closing", async () => {
  mocks.save.mockResolvedValue({
    ok: true,
    message: "2 saved, 0 already saved, 0 invalid in Research Resources.",
  });
  const onClose = vi.fn();
  const { renderer } = await renderReview({ onClose });

  await act(async () => button(renderer, "Save links").props.onClick());

  expect(mocks.announce).toHaveBeenCalledWith(
    "2 saved, 0 already saved, 0 invalid in Research Resources.",
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mocks.announce.mock.invocationCallOrder[0])
    .toBeLessThan(onClose.mock.invocationCallOrder[0]);
});

test("a save completion from a replaced review cannot announce, close, or corrupt the new review", async () => {
  let resolveSave!: (result: { ok: true; message: string }) => void;
  const pendingSave = new Promise<{ ok: true; message: string }>((resolve) => {
    resolveSave = resolve;
  });
  mocks.save.mockReturnValue(pendingSave);
  const reviewA = {};
  const reviewB = {};
  const onCloseA = vi.fn();
  const onCloseB = vi.fn();
  const { renderer, props } = await renderReview({
    links: ["https://a.example"],
    task: null,
    reviewIdentity: reviewA,
    onClose: onCloseA,
  });

  await act(async () => button(renderer, "Save links").props.onClick());
  expect(button(renderer, "Save links").props.disabled).toBe(true);

  await act(async () => {
    renderer.update(createElement(FollowUpLinkReview, {
      ...props,
      links: ["https://b.example"],
      reviewIdentity: reviewB,
      onClose: onCloseB,
    }));
  });
  expect(controls(renderer, "checkbox").map((node) => text(node.parent?.children))).toEqual([
    "https://b.example",
  ]);
  expect(button(renderer, "Save links").props.disabled).toBe(false);

  await act(async () => {
    resolveSave({ ok: true, message: "A saved." });
    await pendingSave;
  });

  expect(mocks.announce).not.toHaveBeenCalled();
  expect(onCloseA).not.toHaveBeenCalled();
  expect(onCloseB).not.toHaveBeenCalled();
  expect(controls(renderer, "checkbox").map((node) => node.props.checked)).toEqual([true]);
  expect(button(renderer, "Save links").props.disabled).toBe(false);
});

test("retains shared Modal and accessible native-control wiring", () => {
  const source = readFileSync(
    new URL("./chat-follow-up-link-review.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /import \{ Modal \} from "@\/components\/ui\/modal"/);
  assert.match(source, /breadcrumb=\{\["Chat", "Save links"\]\}/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /type="radio"/);
  assert.match(source, /className="[^"]*focus-ring[^"]*"/);
  assert.match(source, /role="alert"/);
});

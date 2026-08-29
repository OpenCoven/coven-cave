// @ts-nocheck — react-test-renderer ships no types; rendered component behavior test.
import React from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";
import { FOCUSABLE } from "@/lib/use-focus-trap";

import { ResearchResourceBrowserModal } from "./research-resource-browser-modal";

// The shared Modal portals via createPortal, which needs a real DOM container;
// react-test-renderer never provides one. Short-circuit the portal to return its
// child in place (matching x-publish-panel-behavior.test.tsx) and stub the Icon
// so no icon machinery loads. useFocusTrap's DOM effect no-ops safely because
// its ref resolves to null under react-test-renderer.
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
(globalThis as { document?: unknown }).document = { body: {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  onClose: () => {},
  title: "Field notes",
  url: "https://example.com/article",
  remoteContentRolloutEnabled: true,
  contextPackConsent: { allowRemoteContent: true },
};

function render(props: Partial<typeof baseProps> = {}) {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <ResearchResourceBrowserModal {...baseProps} {...props} />,
    );
  });
  return renderer;
}

describe("ResearchResourceBrowserModal", () => {
  test("renders nothing when closed", () => {
    const renderer = render({ open: false });
    expect(renderer.toJSON()).toBeNull();
  });

  test("opens as an accessible dialog and closes through its close button", () => {
    const onClose = vi.fn();
    const renderer = render({ open: true, onClose });

    const dialog = renderer.root.findByProps({ role: "dialog" });
    expect(dialog.props["aria-modal"]).toBe("true");

    const close = renderer.root.findByProps({ "aria-label": "Close" });
    act(() => close.props.onClick());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("passes the resource URL only when rollout and explicit consent are both enabled", () => {
    const renderer = render({ open: true, url: "https://example.com/article" });

    const frame = renderer.root.findByType("iframe");
    expect(frame.props.src).toBe("https://example.com/article");
    expect(frame.props.title).toBe("Field notes — browser preview");
    expect(frame.props.sandbox).toContain("allow-scripts");
    expect(frame.props.sandbox).toContain("allow-forms");
    expect(frame.props.tabIndex).toBe(0);
    expect(frame.props.className).toContain("focus-ring");
    expect(FOCUSABLE).toContain("[tabindex]:not([tabindex='-1'])");
  });

  test.each([
    {
      label: "consent is missing",
      props: { contextPackConsent: undefined },
    },
    {
      label: "consent explicitly denies remote content",
      props: { contextPackConsent: { allowRemoteContent: false } },
    },
    {
      label: "the rollout is disabled despite explicit consent",
      props: { remoteContentRolloutEnabled: false },
    },
  ])("never loads the URL when $label", ({ props }) => {
    const renderer = render({ open: true, ...props });

    expect(renderer.root.findAllByType("iframe")).toHaveLength(0);
    const gated = renderer.root.findByProps({ role: "status" });
    expect(gated.findByType("strong").children.join("")).toContain("Remote content is off");
  });

  test("shows a no-source notice when consent is on but the resource has no URL", () => {
    const renderer = render({ open: true, url: null });

    expect(renderer.root.findAllByType("iframe")).toHaveLength(0);
    const gated = renderer.root.findByProps({ role: "status" });
    expect(gated.findByType("strong").children.join("")).toContain("No source URL");
  });
});

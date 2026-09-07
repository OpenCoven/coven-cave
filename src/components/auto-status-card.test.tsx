// @ts-nocheck — react-test-renderer ships no types; matches the repository convention.
//
// Behavioral test for the /auto status card's approve/deny affordance: the
// `needs-approval` state renders Approve/Deny buttons that call the handlers,
// while `blocked` (cannot-proceed) and a needs-approval card with no handlers
// (a historical marker) render no affordance at all.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { AutoStatusCard } from "./auto-status-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: { children?: unknown[] }): string {
  return (node.children ?? [])
    .map((child) =>
      typeof child === "string"
        ? child
        : child && typeof child === "object"
          ? textContent(child as { children?: unknown[] })
          : "",
    )
    .join("");
}

async function renderCard(
  state: Parameters<typeof AutoStatusCard>[0]["state"],
  handlers?: { onApprove?: () => void; onDeny?: () => void },
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <AutoStatusCard
        state={state}
        note="short status"
        onApprove={handlers?.onApprove}
        onDeny={handlers?.onDeny}
      />,
    );
  });
  return renderer!;
}

describe("AutoStatusCard approve/deny affordance", () => {
  it("renders Approve and Deny for a live needs-approval state", async () => {
    const renderer = await renderCard("needs-approval", {
      onApprove: () => undefined,
      onDeny: () => undefined,
    });
    expect(textContent(renderer.root)).toContain("needs your go-ahead");
    const buttons = renderer.root.findAllByType("button");
    expect(buttons).toHaveLength(2);
    expect(textContent(buttons[0])).toContain("Approve");
    expect(textContent(buttons[1])).toContain("Deny");
  });

  it("clicking Approve calls the approve handler and Deny calls the deny handler", async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const renderer = await renderCard("needs-approval", { onApprove, onDeny });
    const buttons = renderer.root.findAllByType("button");
    const approve = buttons.find((b) => textContent(b).includes("Approve"))!;
    const deny = buttons.find((b) => textContent(b).includes("Deny"))!;

    await act(async () => {
      approve.props.onClick();
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();

    await act(async () => {
      deny.props.onClick();
    });
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("blocked (cannot-proceed) renders the wall with no affordance", async () => {
    const renderer = await renderCard("blocked");
    expect(textContent(renderer.root)).toContain("blocked — cannot proceed");
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
  });

  it("a needs-approval card without handlers renders no affordance", async () => {
    const renderer = await renderCard("needs-approval");
    expect(textContent(renderer.root)).toContain("needs your go-ahead");
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
  });

  it("done keeps the existing terminal state", async () => {
    const renderer = await renderCard("done");
    expect(textContent(renderer.root)).toContain("mission complete");
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
  });
});

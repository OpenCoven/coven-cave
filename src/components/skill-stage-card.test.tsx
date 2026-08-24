// @ts-nocheck — react-test-renderer ships no types; matches the repository convention.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { SkillRunSummary } from "./skill-stage-card";

vi.mock("@/components/ui/modal", () => ({
  Modal: ({
    open,
    breadcrumb,
    children,
    footerPills,
    footerActions,
  }: {
    open: boolean;
    breadcrumb?: unknown[];
    children: unknown;
    footerPills?: unknown;
    footerActions?: unknown;
  }) =>
    open ? (
      <div data-modal={true} data-breadcrumb={breadcrumb?.join(" › ")}>
        {children}
        {footerPills}
        {footerActions}
      </div>
    ) : null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderSummary(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <SkillRunSummary
        skills={[
          {
            name: "brainstorming",
            stage: "done",
            note: "Applicability gate confirms direct implementation.",
          },
          {
            name: "test-driven-development",
            stage: "done",
            note: "Governance and CI contracts passed red-green.",
          },
          {
            name: "requesting-code-review",
            stage: "done",
            note: "No significant issues found.",
          },
        ]}
      />,
    );
  });
  return renderer!;
}

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

describe("SkillRunSummary", () => {
  it("opens one run-wide modal from every skill card and highlights the selected skill", async () => {
    const renderer = await renderSummary();
    expect(renderer.root.findAllByProps({ "data-modal": true })).toHaveLength(0);

    const trigger = renderer.root.findByProps({
      "aria-label":
        "Open details for skill test-driven-development: done — Governance and CI contracts passed red-green.",
    });
    await act(async () => {
      trigger.props.onClick();
    });

    const modal = renderer.root.findByProps({ "data-modal": true });
    expect(modal.props["data-breadcrumb"]).toBe("Chat › Run skills");
    expect(textContent(modal)).toContain("Skills used in this run");
    expect(textContent(modal)).toContain("Applicability gate confirms direct implementation.");
    expect(textContent(modal)).toContain("Governance and CI contracts passed red-green.");
    expect(textContent(modal)).toContain("No significant issues found.");
    expect(modal.findAllByProps({ "data-selected": true })).toHaveLength(1);
    expect(textContent(modal.findByProps({ "data-selected": true }))).toContain(
      "test-driven-development",
    );
  });
});

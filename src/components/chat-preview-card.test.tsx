// @ts-nocheck
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/icon", () => ({
  Icon: () => <span aria-hidden="true" />,
}));

vi.mock("@/lib/research-mission-client", () => ({
  getResearchMission: vi.fn(async () => ({
    ok: true,
    mission: {
      id: "run-live",
      familiarId: "sage",
      title: "Live research",
      mode: "paper",
      status: "running",
      sources: [],
      artifacts: [],
      iterations: [{ summary: "Gathering", steps: [] }],
      createdAt: "2026-08-22T10:00:00.000Z",
      updatedAt: "2026-08-22T10:01:00.000Z",
    },
  })),
  actOnResearchMission: vi.fn(),
}));

import { ChatPreviewCard } from "./chat-preview-card";
import { ResearchRunInlineCard, ResearchRunSurface } from "./research-run-surface";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

test("local preview card opens the Browser split callback", async () => {
  const onOpenPreview = vi.fn();
  let renderer;
  await act(async () => {
    renderer = create(
      <ChatPreviewCard
        preview={{ url: "http://127.0.0.1:3000/demo", title: "Demo" }}
        onOpenPreview={onOpenPreview}
      />,
    );
  });

  const button = renderer.root.findByType("button");
  expect(textContent(button.children)).toContain("Open beside chat");
  await act(async () => button.props.onClick());
  expect(onOpenPreview).toHaveBeenCalledWith("http://127.0.0.1:3000/demo");
  expect(textContent(renderer.root)).toContain("127.0.0.1:3000/demo");
});

test("canonical live runs expose only the backend-supported cancel action", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      <ResearchRunInlineCard snapshot={{
        runId: "run-live",
        title: "Live research",
        status: "running",
        steps: [],
        evidence: {},
      }} />,
    );
  });

  const labels = renderer.root.findAllByType("button").map((button) => textContent(button.children));
  expect(labels).toContain("Stop");
  expect(labels).not.toContain("Pause");
  await act(async () => renderer.unmount());
});

test("step status is exposed to assistive technology as text", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      <ResearchRunSurface run={{
        runId: "run-status",
        title: "Status research",
        status: "running",
        activity: "Gathering",
        steps: [{ id: "gather", label: "Gather sources", status: "blocked" }],
        evidence: {},
      }} />,
    );
  });

  expect(textContent(renderer.root)).toContain("Blocked");
  await act(async () => renderer.unmount());
});

test("aggregate progress describes skipped stages as resolved", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      <ResearchRunSurface run={{
        runId: "run-skipped",
        title: "Skipped-stage research",
        status: "running",
        activity: "Gathering",
        steps: [{ id: "optional", label: "Optional source", status: "skipped" }],
        evidence: {},
      }} />,
    );
  });

  expect(textContent(renderer.root)).toContain("1 of 1 stages resolved");
  expect(textContent(renderer.root)).not.toContain("stages complete");
  await act(async () => renderer.unmount());
});

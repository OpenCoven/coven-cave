// @ts-nocheck
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";

import { ResearchTopicCard } from "./research-topic-card";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROPOSAL = {
  schema: "opencoven.topic-proposal/v1",
  id: "proposal_a",
  discoveryJobId: "topicjob_a",
  contextPackId: "ctx_a",
  title: "A grounded topic",
  question: "Is this worth investigating?",
  whyNow: "because the window is open",
  evidence: [
    {
      resourceId: "resource_a",
      selector: { type: "text-span", start: 0, end: 5 },
      excerpt: "exact excerpt text",
      excerptDigest: "a".repeat(64),
    },
  ],
  counterevidence: [],
  scores: {
    groundability: 3,
    decisionValue: 2,
    unresolvedness: 2,
    recurrence: 2,
    novelty: 2,
    timeliness: 2,
    familiarFit: 2,
    feasibility: 2,
    humanResonance: 2,
    riskPenalty: 0,
    visibleTotal: 2.18,
  },
  suggested: { mode: "sweep", deliverable: "a report", sourceTarget: 8, wallClockMinutes: 45 },
  uncertainty: "low",
  relatedMissionIds: ["mission_mission-1"],
  createdAt: "2026-08-28T10:00:00.000Z",
};

function textContent(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent(node.children);
  }
  return "";
}

function buttonWith(renderer, text) {
  return renderer.root
    .findAllByType("button")
    .find((button) => textContent(button.children).includes(text));
}

test("renders the recomputed score breakdown and exact excerpts", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<ResearchTopicCard proposal={PROPOSAL} onUse={() => {}} />);
  });
  const text = textContent(renderer.root);
  expect(text).toContain("A grounded topic");
  expect(text).toContain("Is this worth investigating?");
  expect(text).toContain("2.18");
  expect(text).toContain("Groundability");
  expect(text).toContain("Risk penalty");

  await act(async () => {
    buttonWith(renderer, "Why this?").props.onClick();
  });
  expect(textContent(renderer.root)).toContain("exact excerpt text");
});

test("Use this topic calls onUse; Dismiss and Edit question are local", async () => {
  const onUse = vi.fn();
  const onDismiss = vi.fn();
  const onEditQuestion = vi.fn();
  let renderer;
  await act(async () => {
    renderer = create(
      <ResearchTopicCard
        proposal={PROPOSAL}
        onUse={onUse}
        onDismiss={onDismiss}
        onEditQuestion={onEditQuestion}
      />,
    );
  });

  await act(async () => {
    buttonWith(renderer, "Use this topic").props.onClick();
  });
  expect(onUse).toHaveBeenCalledWith(PROPOSAL);

  await act(async () => {
    buttonWith(renderer, "Dismiss").props.onClick();
  });
  expect(onDismiss).toHaveBeenCalledWith("proposal_a");

  await act(async () => {
    buttonWith(renderer, "Edit question").props.onClick();
  });
  expect(onEditQuestion).toHaveBeenCalledWith("proposal_a");

  // These are local callbacks — the card performs no fetch itself.
  expect(onUse).toHaveBeenCalledTimes(1);
});

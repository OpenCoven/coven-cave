import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { ThreadSignalCard, topPersistentBlocker } from "./thread-signal-card.tsx";
import type { ThreadSelfReport } from "@/lib/thread-self-report";

function report(overrides: Partial<ThreadSelfReport> = {}): ThreadSelfReport {
  return {
    id: "report-1",
    familiarId: "cody",
    sessionId: "session-1",
    threadTitle: "Cody",
    reportedAt: "2026-06-25T12:00:00.000Z",
    overallConfidence: 84,
    overallConfidenceReason: "clear path",
    toolReliability: { score: 71, failedTools: [], unreliableTools: [] },
    contextPressure: "critical",
    skillsUsed: [],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesLacking: [],
    capabilitiesVital: [],
    memoryRecallScore: 63,
    fileLocatabilityScore: 58,
    persistentBlockers: [],
    ...overrides,
  };
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return flattenText((node as ReactElement<{ children?: ReactNode }>).props.children);
}

function findByText(node: ReactNode, text: string): ReactElement<Record<string, unknown>> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByText(child, text);
      if (found) return found;
    }
    return null;
  }
  if (!("props" in node)) return null;
  const element = node as ReactElement<{ children?: ReactNode }>;
  const child = findByText(element.props.children, text);
  if (child) return child;
  if (flattenText(element).includes(text)) return element as ReactElement<Record<string, unknown>>;
  return null;
}

describe("ThreadSignalCard", () => {
  it("renders confidence, tool reliability, and context severity class", () => {
    const card = ThreadSignalCard({ report: report(), onViewFull: () => {}, onDismiss: () => {} });
    const text = flattenText(card);

    assert.match(text, /Confidence84/);
    assert.match(text, /Tool reliability71/);
    assert.match(text, /ContextCritical/);
    assert.match(JSON.stringify(card), /tsc-score-item--crit/);
  });

  it("shows the highest-impact blocker line only when blockers exist", () => {
    const withBlockers = report({
      persistentBlockers: [
        { id: "low", title: "Minor cleanup", category: "other", impact: "low", detail: "nice" },
        { id: "high", title: "Missing auth", category: "auth", impact: "blocking", detail: "blocked" },
      ],
    });

    assert.equal(topPersistentBlocker(withBlockers)?.title, "Missing auth");
    assert.match(flattenText(ThreadSignalCard({ report: withBlockers, onViewFull: () => {}, onDismiss: () => {} })), /2 blockers: Missing auth \(blocking\)/);
    assert.doesNotMatch(flattenText(ThreadSignalCard({ report: report(), onViewFull: () => {}, onDismiss: () => {} })), /blocker/);
  });

  it("calls onDismiss and onViewFull from their actions", () => {
    let dismissed = false;
    let viewed = false;
    const card = ThreadSignalCard({
      report: report(),
      onDismiss: () => { dismissed = true; },
      onViewFull: () => { viewed = true; },
    });

    const event = { preventDefault() {} };
    (findByText(card, "Dismiss")?.props.onClick as ((event: unknown) => void) | undefined)?.(event);
    (findByText(card, "View full report")?.props.onClick as ((event: unknown) => void) | undefined)?.(event);

    assert.equal(dismissed, true);
    assert.equal(viewed, true);
  });
});

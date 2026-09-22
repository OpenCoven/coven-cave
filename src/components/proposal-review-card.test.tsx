// @ts-nocheck — react-test-renderer ships no types; matches the repository convention.
//
// Behavioral test for the proposal-review receipt card: every rendered field
// is text (verdict, subject, reason, answers with confidence, reviewer, the
// fixed evidence line), the verdict is exposed as data for styling, and there
// is never a button — the card is evidence, not an affordance.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import {
  PROPOSAL_REVIEW_EVIDENCE_COPY,
  ProposalReviewCard,
  formatConfidence,
  humanizeAnswerId,
} from "./proposal-review-card";
import { sliceProposalReviewBlocks } from "@/lib/proposal-review-blocks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MARKER =
  '<coven:proposal-review tool="propose_patch" target="src/x.ts" verdict="proposal_only" reviewer="jev-1.13.0" q="addresses_task:yes:0.93|evidence_supports:yes:0.91|unrelated_changes:no:0.96|needs_clarification:yes:0.88" reason="needs clarification" />';

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

function reviewFrom(marker: string) {
  const piece = sliceProposalReviewBlocks(marker)[0];
  if (piece.kind !== "proposal-review") throw new Error("expected a review piece");
  return piece.review;
}

async function renderCard(marker: string): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ProposalReviewCard review={reviewFrom(marker)} />);
  });
  return renderer!;
}

describe("ProposalReviewCard", () => {
  it("renders the verdict, subject, reason, answers with confidence, reviewer, and the evidence line as text", async () => {
    const renderer = await renderCard(MARKER);
    const text = textContent(renderer.root);
    expect(text).toContain("review: proposal only");
    expect(text).toContain("propose_patch → src/x.ts");
    expect(text).toContain("needs clarification");
    expect(text).toContain("addresses task");
    expect(text).toContain("93% confidence");
    expect(text).toContain("unrelated changes");
    expect(text).toContain("jev-1.13.0");
    expect(text).toContain(PROPOSAL_REVIEW_EVIDENCE_COPY);
    const root = renderer.root.findByProps({ role: "group" });
    expect(root.props["data-verdict"]).toBe("proposal_only");
    expect(root.props["aria-label"]).toBe("Proposal review: review: proposal only — needs clarification");
  });

  it("never renders a button or any approve/deny affordance", async () => {
    const renderer = await renderCard(MARKER);
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
    const text = textContent(renderer.root);
    expect(text).not.toMatch(/\bApprove\b|\bDeny\b/);
  });

  it("labels each verdict with text and a distinct data attribute", async () => {
    const cases: Array<[string, string]> = [
      ["permit", "review: permit"],
      ["reject", "review: reject"],
      ["unavailable", "review unavailable"],
      ["something-else", "review unavailable"],
    ];
    for (const [verdict, label] of cases) {
      const renderer = await renderCard(
        `<coven:proposal-review tool="run_command" verdict="${verdict}" q="addresses_task:yes:0.5" />`,
      );
      expect(textContent(renderer.root)).toContain(label);
      const expected = verdict === "something-else" ? "unavailable" : verdict;
      expect(renderer.root.findByProps({ role: "group" }).props["data-verdict"]).toBe(expected);
    }
  });

  it("omits confidence text when a triple carries none and formats ids as words", () => {
    expect(formatConfidence(null)).toBeNull();
    expect(formatConfidence(0.875)).toBe("88% confidence");
    expect(humanizeAnswerId("needs_clarification")).toBe("needs clarification");
    expect(humanizeAnswerId("unrelated-changes")).toBe("unrelated changes");
  });
});

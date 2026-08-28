// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test } from "vitest";

import { ApprovalCard } from "./ApprovalCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FIRST_QUESTION = "How many flavors should we launch?";
const SECOND_QUESTION = "Which mix-ins should we stock?";

function renderApprovalCard(variant?: string): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<ApprovalCard variant={variant} />);
  });
  return renderer;
}

function textOf(renderer: ReactTestRenderer): string {
  return textOfInstance(renderer.root);
}

function textOfInstance(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map((child) => textOfInstance(child)).join("");
}

function findByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAll(
    (node) => node.props?.["aria-label"] === label,
  );
  return found[0];
}

describe("ApprovalCard", () => {
  test("renders the questions variant by default", () => {
    const renderer = renderApprovalCard();
    const text = textOf(renderer);

    expect(text).toContain(FIRST_QUESTION);
    expect(text).toContain("Three (core line)");
    expect(text).toContain("Five (full case)");
    expect(text).toContain("Just one hero");

    // one pager dot per question in the queue
    expect(findByLabel(renderer, "Go to question 1")).toBeTruthy();
    expect(findByLabel(renderer, "Go to question 2")).toBeTruthy();
    expect(findByLabel(renderer, "Go to question 3")).toBeTruthy();
  });

  test("renders the questions variant when selected explicitly", () => {
    const renderer = renderApprovalCard("Questions");
    expect(textOf(renderer)).toContain(FIRST_QUESTION);
  });

  test("falls back to the questions variant for an unknown variant", () => {
    const renderer = renderApprovalCard("NotARealVariant");
    expect(textOf(renderer)).toContain(FIRST_QUESTION);
  });

  test("pages through the question queue in the questions variant", () => {
    const renderer = renderApprovalCard("Questions");

    act(() => {
      findByLabel(renderer, "Next").props.onClick();
    });

    expect(textOf(renderer)).toContain(SECOND_QUESTION);
  });
});

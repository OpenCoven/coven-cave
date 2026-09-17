// @ts-nocheck — react-test-renderer ships no types; rendered control behavior test.
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";

import { CodeReviewQueueControls } from "./code-review-queue-controls";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

function findButton(renderer: ReturnType<typeof create>, label: string) {
  return renderer.root.find(
    (node) => node.type === "button" && textContent(node.children).includes(label),
  );
}

test("renders compact Session scope controls with counts, pressed state, and the outside-filter notice", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      <CodeReviewQueueControls
        mode="reviewable"
        reviewableCount={3}
        allLocalCount={8}
        outsideCurrentFilter
        onModeChange={() => {}}
      />,
    );
  });

  const scope = renderer.root.findByProps({ role: "group", "aria-label": "Session scope" });
  expect(textContent(scope.children)).toContain("Reviewable");
  expect(textContent(scope.children)).toContain("3");
  expect(textContent(scope.children)).toContain("All local");
  expect(textContent(scope.children)).toContain("8");

  const reviewable = findButton(renderer, "Reviewable");
  const allLocal = findButton(renderer, "All local");
  expect(reviewable.props["aria-pressed"]).toBe(true);
  expect(allLocal.props["aria-pressed"]).toBe(false);

  const notice = renderer.root.findByProps({ className: "code-queue-filter__notice" });
  expect(textContent(notice.children)).toBe("Outside current filter");

  await act(async () => renderer.unmount());
});

test("clicking the controls emits the requested queue mode", async () => {
  const onModeChange = vi.fn();
  let renderer;
  await act(async () => {
    renderer = create(
      <CodeReviewQueueControls
        mode="all"
        reviewableCount={2}
        allLocalCount={5}
        onModeChange={onModeChange}
      />,
    );
  });

  const reviewable = findButton(renderer, "Reviewable");
  const allLocal = findButton(renderer, "All local");

  await act(async () => reviewable.props.onClick());
  await act(async () => allLocal.props.onClick());

  expect(onModeChange).toHaveBeenNthCalledWith(1, "reviewable");
  expect(onModeChange).toHaveBeenNthCalledWith(2, "all");

  await act(async () => renderer.unmount());
});

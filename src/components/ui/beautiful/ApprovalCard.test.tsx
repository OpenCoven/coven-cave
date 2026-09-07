// @ts-nocheck
// Behavioral tests for the parameterized ApprovalCard (cave-o9xu3 + cave-8k9bc).
// The component was lifted from upstream's ice-cream fixture into a typed
// props surface. These pins hold two contracts at once:
//   - cave-8k9bc: the `variant` prop selects a question set (Questions is the
//     default) and unknown variants fall back to it, and the queue still pages.
//   - cave-o9xu3: default props reproduce the fixture verbatim, while the new
//     props (title/description/verb labels/kind/resource/scopes/allow-deny/
//     children/footer) render and fire their callbacks.
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";

import { ApprovalCard } from "./ApprovalCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

function buttons(renderer: { root: { findAllByType: (t: string) => unknown[] } }) {
  return renderer.root.findAllByType("button");
}

function buttonByText(renderer: unknown, label: string) {
  return buttons(renderer).find((button) => textContent(button.children) === label);
}

function buttonByLabel(renderer: unknown, label: string) {
  return buttons(renderer).find((button) => button.props["aria-label"] === label);
}

test("renders the questions variant by default, unchanged from the fixture", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<ApprovalCard />);
  });

  const text = textContent(renderer.root);
  expect(text).toContain("How many flavors should we launch?");
  expect(text).toContain("Three (core line)");
  expect(text).toContain("Five (full case)");
  expect(text).toContain("Just one hero");
  // the free-text answer input keeps its placeholder
  expect(renderer.root.findByType("input").props.placeholder).toBe("Type something…");

  // one pager dot per question
  expect(buttonByLabel(renderer, "Go to question 1")).toBeTruthy();
  expect(buttonByLabel(renderer, "Go to question 2")).toBeTruthy();
  expect(buttonByLabel(renderer, "Go to question 3")).toBeTruthy();
  // the send arrow is labelled for the first (non-last) question
  expect(buttonByLabel(renderer, "Next question")).toBeTruthy();

  await act(async () => renderer.unmount());
});

test("renders the questions variant when selected explicitly", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<ApprovalCard variant="Questions" />);
  });
  expect(textContent(renderer.root)).toContain("How many flavors should we launch?");
  await act(async () => renderer.unmount());
});

test("falls back to the questions variant for an unknown variant", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<ApprovalCard variant="NotARealVariant" />);
  });
  expect(textContent(renderer.root)).toContain("How many flavors should we launch?");
  await act(async () => renderer.unmount());
});

test("pages through the question queue via the Next chevron", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<ApprovalCard variant="Questions" />);
  });
  await act(async () => {
    buttonByLabel(renderer, "Next").props.onClick();
  });
  expect(textContent(renderer.root)).toContain("Which mix-ins should we stock?");
  await act(async () => renderer.unmount());
});

test("custom question copy, title and verb labels render", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      <ApprovalCard
        title="Review the plan"
        description="Confirm the rollout before it ships."
        questions={[
          { q: "Ship to production?", type: "radio", options: ["Yes", "No"] },
        ]}
        openLabel="Open review"
        dismissLabel="Close"
        restartLabel="Reset"
        sentLabel="Plan sent"
        sendLabel="Ship it"
        nextLabel="Forward"
        previousLabel="Back"
        customPlaceholder="Add a note…"
      />,
    );
  });

  const text = textContent(renderer.root);
  expect(text).toContain("Review the plan");
  expect(text).toContain("Confirm the rollout before it ships.");
  expect(text).toContain("Ship to production?");
  expect(text).toContain("Yes");
  expect(text).toContain("No");
  expect(renderer.root.findByType("input").props.placeholder).toBe("Add a note…");

  // verb labels reach their controls
  expect(buttonByLabel(renderer, "Close")).toBeTruthy();
  expect(buttonByLabel(renderer, "Back")).toBeTruthy();
  expect(buttonByLabel(renderer, "Forward")).toBeTruthy();
  // the single question is also the last, so the send arrow carries sendLabel
  expect(buttonByLabel(renderer, "Ship it")).toBeTruthy();

  await act(async () => renderer.unmount());
});

test("permission prompt renders resource, scopes and allow/deny verbs and fires callbacks", async () => {
  const onAllow = vi.fn();
  const onDeny = vi.fn();
  const onDismiss = vi.fn();
  let renderer;
  await act(async () => {
    renderer = create(
      <ApprovalCard
        kind="danger"
        title="Access your repositories"
        description="This familiar is asking for repository access."
        resourceName="coven-cave"
        scopes={[
          { label: "Read access", detail: "Public and private repositories" },
          { label: "Write access", detail: "Push to protected branches" },
        ]}
        allowLabel="Allow access"
        denyLabel="Deny"
        onAllow={onAllow}
        onDeny={onDeny}
        onDismiss={onDismiss}
      />,
    );
  });

  const text = textContent(renderer.root);
  expect(text).toContain("Access your repositories");
  expect(text).toContain("This familiar is asking for repository access.");
  expect(text).toContain("Danger");
  expect(text).toContain("coven-cave");
  expect(text).toContain("Read access");
  expect(text).toContain("Public and private repositories");
  expect(text).toContain("Write access");
  expect(text).toContain("Push to protected branches");

  // the question queue must not render alongside the permission prompt
  expect(text).not.toContain("How many flavors should we launch?");

  const allow = buttonByText(renderer, "Allow access");
  const deny = buttonByText(renderer, "Deny");
  expect(allow).toBeTruthy();
  expect(deny).toBeTruthy();

  await act(async () => allow.props.onClick());
  expect(onAllow).toHaveBeenCalledTimes(1);
  expect(onDeny).not.toHaveBeenCalled();
  await act(async () => deny.props.onClick());
  expect(onDeny).toHaveBeenCalledTimes(1);

  // the dismiss affordance stays available in permission mode
  const dismiss = buttonByLabel(renderer, "Dismiss");
  expect(dismiss).toBeTruthy();
  await act(async () => dismiss.props.onClick());
  expect(onDismiss).toHaveBeenCalledTimes(1);

  await act(async () => renderer.unmount());
});

test("children and footer slots replace the body and footer", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      <ApprovalCard
        children={<span>Custom body</span>}
        footer={<button type="button">Custom action</button>}
      />,
    );
  });

  const text = textContent(renderer.root);
  expect(text).toContain("Custom body");
  expect(text).toContain("Custom action");
  // the fixture queue is not rendered when children take over the body
  expect(text).not.toContain("How many flavors should we launch?");

  await act(async () => renderer.unmount());
});

// @ts-nocheck
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/icon", () => ({
  Icon: () => <span aria-hidden="true" />,
}));

import { ChatPreviewCard } from "./chat-preview-card";

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


// @ts-nocheck
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LiveRegionProvider } from "@/components/ui/live-region";

vi.mock("@/components/ui/modal", async () => {
  const { createElement } = await import("react");
  return {
    Modal: ({ children, footerActions, ariaDescribedBy, onClose }) =>
      createElement(
        "div",
        { role: "dialog", "aria-describedby": ariaDescribedBy },
        createElement("button", { type: "button", onClick: onClose }, "Close"),
        children,
        footerActions,
      ),
  };
});
vi.mock("@/lib/icon", async (importOriginal) => {
  const { createElement } = await import("react");
  const actual = await importOriginal<typeof import("@/lib/icon")>();
  return {
    ...actual,
    Icon: () => createElement("span", { "aria-hidden": "true" }),
  };
});

import { ChatBroadcastComposer } from "./chat-broadcast-composer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

function buttonByText(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) => node.type === "button" && textContent(node.children) === label,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("composer explains fan-out, keeps a visible label, and submits with Command/Ctrl+Enter", async () => {
  let resolveFetch!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValue(
    new Promise((resolve) => {
      resolveFetch = resolve;
    }),
  );
  const onSent = vi.fn();
  const onClose = vi.fn();
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      createElement(
        LiveRegionProvider,
        null,
        createElement(ChatBroadcastComposer, {
          targets: ["one", "two"],
          onSent,
          onClose,
        }),
      ),
    );
  });

  const dialog = renderer.root.findByProps({ role: "dialog" });
  expect(textContent(dialog.children)).toContain(
    "One message is sent separately to 2 chats. Replies stay in each chat.",
  );
  expect(renderer.root.findByType("label").children.join("")).toBe("Message");

  const textarea = renderer.root.findByType("textarea");
  expect(textarea.props.placeholder).toBe("Message selected chats…");
  await act(async () => {
    textarea.props.onChange({ target: { value: "Status update" } });
  });

  const preventDefault = vi.fn();
  await act(async () => {
    textarea.props.onKeyDown({
      key: "Enter",
      metaKey: true,
      ctrlKey: false,
      preventDefault,
    });
  });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(buttonByText(renderer, "Sending to 2 chats…").props["aria-busy"]).toBe(true);
  await act(async () => {
    buttonByText(renderer, "Close").props.onClick();
  });
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => {
    resolveFetch({
      ok: true,
      json: async () => ({
        ok: true,
        results: [
          { sessionId: "one", ok: true, runId: "run-one" },
          { sessionId: "two", ok: true, runId: "run-two" },
        ],
      }),
    } as Response);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(onSent).toHaveBeenCalledWith([
    { sessionId: "one", ok: true, runId: "run-one" },
    { sessionId: "two", ok: true, runId: "run-two" },
  ]);
  expect(onClose).toHaveBeenCalledTimes(1);
  const status = renderer.root.findByProps({ role: "status" });
  expect(textContent(status.children)).toBe("Sent to 2 chats.");

  await act(async () => renderer.unmount());
});

test("composer keeps API failures open and announces the error assertively", async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: false,
    json: async () => ({ ok: false, error: "broadcast unavailable" }),
  } as Response);
  const onSent = vi.fn();
  const onClose = vi.fn();
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      createElement(
        LiveRegionProvider,
        null,
        createElement(ChatBroadcastComposer, {
          targets: ["one"],
          onSent,
          onClose,
        }),
      ),
    );
  });

  const textarea = renderer.root.findByType("textarea");
  await act(async () => {
    textarea.props.onChange({ target: { value: "Status update" } });
    await Promise.resolve();
  });
  await act(async () => {
    buttonByText(renderer, "Send to 1 chat").props.onClick();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(onSent).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  const inlineError = renderer.root.find(
    (node) => node.props.role === "alert" && node.props.className === "chat-broadcast__error",
  );
  expect(textContent(inlineError.children).trim()).toBe(
    "Couldn't send this broadcast. broadcast unavailable",
  );

  await act(async () => renderer.unmount());
});

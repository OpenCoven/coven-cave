// @ts-nocheck
import { createElement, useEffect, useRef } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, test, vi } from "vitest";

const modalLifecycle = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
}));

vi.mock("@/components/message-bubble", () => ({
  SyntaxBlock: ({ text }: { text: string }) => createElement("syntax-block", { text }),
}));

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, onClose, children }: {
    open: boolean;
    onClose: () => void;
    children: unknown;
  }) => {
    const focusRef = useRef(null);
    useEffect(() => {
      modalLifecycle.mounts += 1;
      return () => {
        modalLifecycle.unmounts += 1;
      };
    }, []);
    useEffect(() => {
      if (open) focusRef.current?.focus();
    }, [open]);
    return createElement(
      "review-modal",
      { open },
      open
        ? createElement("button", { ref: focusRef, onClick: onClose }, "Close review")
        : null,
      open ? children : null,
    );
  },
}));

import { EditCardActions } from "./chat-edit-card-actions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "button" && node.children.join("") === label,
  );
}

function actions(projectRoot: string | null, mutationPath: string) {
  return (
    <EditCardActions
      key="tool-call-1"
      projectRoot={projectRoot}
      sourceSessionId="source-chat"
      turnId="turn-1"
      mutationPaths={[mutationPath]}
      diff={"--- a/src/file.ts\n+++ b/src/file.ts"}
      displayPath={mutationPath}
    />
  );
}

describe("EditCardActions lifecycle", () => {
  beforeEach(() => {
    modalLifecycle.mounts = 0;
    modalLifecycle.unmounts = 0;
  });

  test("late root settlement preserves Review lifecycle while target changes reset armed Undo", async () => {
    const dispatched: Event[] = [];
    const focusNodes: Array<{ focus(): void }> = [];
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalFetch = globalThis.fetch;
    let renderer: ReactTestRenderer | undefined;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { dispatchEvent: (event: Event) => dispatched.push(event) },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { activeElement: null },
    });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Undo must not execute in this lifecycle test");
    });

    try {
      await act(async () => {
        renderer = create(actions(null, "src/file.ts"), {
          createNodeMock(element) {
            if (element.type !== "button" || element.props.children !== "Close review") {
              return {};
            }
            const node = {
              focus() {
                globalThis.document.activeElement = node;
              },
            };
            focusNodes.push(node);
            return node;
          },
        });
      });

      const actionNode = renderer.root.findByProps({ className: "cave-edit-card__actions" });
      expect(modalLifecycle).toEqual({ mounts: 1, unmounts: 0 });
      expect(renderer.root.findAllByProps({ className: "cave-edit-card__undo focus-ring" })).toHaveLength(0);

      await act(async () => {
        button(renderer, "Review").props.onClick();
      });
      expect(renderer.root.findByType("review-modal").props.open).toBe(true);
      expect(dispatched).toHaveLength(0);
      expect(focusNodes).toHaveLength(1);
      const focusedReviewControl = globalThis.document.activeElement;

      await act(async () => {
        renderer.update(actions("/repo-a", "src/file.ts"));
      });
      expect(renderer.root.findByProps({ className: "cave-edit-card__actions" })).toBe(actionNode);
      expect(modalLifecycle).toEqual({ mounts: 1, unmounts: 0 });
      expect(renderer.root.findByType("review-modal").props.open).toBe(true);
      expect(globalThis.document.activeElement).toBe(focusedReviewControl);
      expect(focusNodes).toHaveLength(1);
      expect(dispatched).toHaveLength(0);

      await act(async () => {
        button(renderer, "Close review").props.onClick();
      });
      await act(async () => {
        button(renderer, "Review").props.onClick();
      });
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({
        type: "cave:open-file-diff",
        detail: {
          path: "/repo-a/src/file.ts",
          projectRoot: "/repo-a",
          sourceSessionId: "source-chat",
          turnId: "turn-1",
        },
      });

      await act(async () => {
        button(renderer, "Undo").props.onClick();
      });
      expect(button(renderer, "Confirm undo")).toBeDefined();

      await act(async () => {
        renderer.update(actions("/repo-b", "src/file.ts"));
      });
      expect(button(renderer, "Undo")).toBeDefined();
      expect(renderer.root.findAll((node) => node.type === "button" && node.children.join("") === "Confirm undo")).toHaveLength(0);

      await act(async () => {
        button(renderer, "Undo").props.onClick();
      });
      await act(async () => {
        renderer.update(actions("/repo-b", "src/other.ts"));
      });
      expect(button(renderer, "Undo")).toBeDefined();
      expect(renderer.root.findAll((node) => node.type === "button" && node.children.join("") === "Confirm undo")).toHaveLength(0);
      expect(modalLifecycle).toEqual({ mounts: 1, unmounts: 0 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      if (originalWindow === undefined) delete globalThis.window;
      else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      if (originalDocument === undefined) delete globalThis.document;
      else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
      globalThis.fetch = originalFetch;
    }
  });

  test("nested project Undo posts the captured absolute target and rejects a repo-sibling path", async () => {
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    let renderer: ReactTestRenderer | undefined;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { dispatchEvent: vi.fn() },
    });
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await act(async () => {
        renderer = create(actions("/repo/packages/app", "/repo/packages/app/src/a.ts"));
      });
      await act(async () => {
        button(renderer, "Undo").props.onClick();
      });
      await act(async () => {
        await button(renderer, "Confirm undo").props.onClick();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
        projectRoot: "/repo/packages/app",
        path: "/repo/packages/app/src/a.ts",
        confirmUntracked: true,
      });

      await act(async () => {
        renderer.update(actions("/repo/packages/app", "/repo/src/a.ts"));
      });
      expect(
        renderer.root.findAll(
          (node) => node.type === "button" && node.children.join("") === "Undo",
        ),
      ).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      if (originalWindow === undefined) delete globalThis.window;
      else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      globalThis.fetch = originalFetch;
    }
  });
});

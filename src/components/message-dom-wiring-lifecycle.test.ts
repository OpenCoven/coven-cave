// @ts-nocheck
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import {
  useWireCopyButtons,
  type CodeReading,
  type CodeReadingRequest,
} from "./message-dom-wiring.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class FakeButton {
  listeners = new Set<() => void>();
  added = 0;
  removed = 0;

  addEventListener(type: string, listener: () => void) {
    assert.equal(type, "click");
    this.listeners.add(listener);
    this.added += 1;
  }

  removeEventListener(type: string, listener: () => void) {
    assert.equal(type, "click");
    this.listeners.delete(listener);
    this.removed += 1;
  }

  click() {
    for (const listener of this.listeners) listener();
  }
}

function createCodeWrap() {
  const readButton = new FakeButton();
  const compareButton = new FakeButton();
  const attributes = new Map([
    ["data-code-provenance", "generated"],
    ["data-code-path", "src/example.ts"],
    ["data-code-lang", "ts"],
  ]);
  const code = {
    textContent: "const answer = 42;",
    querySelectorAll: () => [],
  };
  const wrap = {
    classList: {
      add() {},
      remove() {},
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    querySelector: (selector: string) => {
      if (selector === "pre code") return code;
      if (selector === ".cave-code-read-btn") return readButton;
      if (selector === ".cave-code-compare-btn") return compareButton;
      if (selector === ".cave-code-stale") return null;
      return null;
    },
  };
  const container = {
    querySelectorAll: (selector: string) =>
      selector === ".cave-code-wrap" ? [wrap] : [],
  };
  return { attributes, container, readButton };
}

function Harness({
  html,
  reading,
  turnId,
}: {
  html: string;
  reading: CodeReading;
  turnId: string;
}) {
  const ref = useWireCopyButtons(
    html,
    undefined,
    null,
    reading,
    "/repo",
    turnId,
  );
  return createElement("div", { ref });
}

const originalMutationObserver = globalThis.MutationObserver;

before(() => {
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
});

after(() => {
  if (originalMutationObserver === undefined) {
    delete globalThis.MutationObserver;
  } else {
    globalThis.MutationObserver = originalMutationObserver;
  }
});

test("same-root null session promotion and turn changes replace stale handlers without unchanged churn", async () => {
  const { container, readButton } = createCodeWrap();
  const initialRequests: CodeReadingRequest[] = [];
  const requests: CodeReadingRequest[] = [];
  const onRead = (request: CodeReadingRequest) => requests.push(request);
  let renderer;

  try {
    await act(async () => {
      renderer = create(
        createElement(Harness, {
          html: "draft",
          reading: {
            sourceSessionId: null,
            onRead: (request) => initialRequests.push(request),
          },
          turnId: "draft-turn",
        }),
        { createNodeMock: () => container },
      );
    });
    assert.equal(readButton.added, 1);
    assert.equal(readButton.removed, 0);

    await act(async () => {
      renderer.update(
        createElement(Harness, {
          html: "draft",
          reading: { sourceSessionId: null, onRead },
          turnId: "draft-turn",
        }),
      );
    });
    assert.equal(readButton.added, 1, "unchanged provenance reuses the handler");
    assert.equal(readButton.removed, 0, "unchanged provenance keeps the handler attached");
    readButton.click();
    assert.equal(initialRequests.length, 0, "a reused handler drops its stale callback");
    assert.equal(requests.length, 1, "a reused handler dispatches through the current callback");
    requests.length = 0;

    await act(async () => {
      renderer.update(
        createElement(Harness, {
          html: "promoted",
          reading: { sourceSessionId: null, onRead },
          turnId: "saved-turn",
        }),
      );
    });
    assert.equal(readButton.added, 2, "turn promotion installs a new handler");
    assert.equal(readButton.removed, 1, "turn promotion removes the stale handler");
    readButton.click();
    assert.deepEqual(
      {
        sourceSessionId: requests[0].sourceSessionId,
        turnId: requests[0].turnId,
      },
      {
        sourceSessionId: null,
        turnId: "saved-turn",
      },
    );
    requests.length = 0;

    await act(async () => {
      renderer.update(
        createElement(Harness, {
          html: "promoted",
          reading: { sourceSessionId: "saved-session", onRead },
          turnId: "saved-turn",
        }),
      );
    });
    assert.equal(readButton.added, 3, "session promotion installs a new handler");
    assert.equal(readButton.removed, 2, "session promotion removes the stale handler");
    readButton.click();
    assert.equal(requests.length, 1);
    assert.deepEqual(
      {
        projectRoot: requests[0].projectRoot,
        sourceSessionId: requests[0].sourceSessionId,
        turnId: requests[0].turnId,
      },
      {
        projectRoot: "/repo",
        sourceSessionId: "saved-session",
        turnId: "saved-turn",
      },
    );
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("path and source provenance changes replace the captured open payload", async () => {
  const { attributes, container, readButton } = createCodeWrap();
  const requests: CodeReadingRequest[] = [];
  const onRead = (request: CodeReadingRequest) => requests.push(request);
  const reading = { sourceSessionId: "saved-session", onRead };
  let renderer;

  try {
    await act(async () => {
      renderer = create(
        createElement(Harness, {
          html: "revision-0",
          reading,
          turnId: "saved-turn",
        }),
        { createNodeMock: () => container },
      );
    });

    const changes = [
      ["data-code-path", "src/promoted.ts", "path", "src/promoted.ts"],
      ["data-code-lang", "tsx", "lang", "tsx"],
      ["data-code-provenance", "quoted", "provenance", "quoted"],
    ];

    for (const [index, [attribute, value, requestField, expected]] of changes.entries()) {
      attributes.set(attribute, value);
      await act(async () => {
        renderer.update(
          createElement(Harness, {
            html: `revision-${index + 1}`,
            reading,
            turnId: "saved-turn",
          }),
        );
      });
      assert.equal(readButton.added, index + 2, `${requestField} change installs a new handler`);
      assert.equal(readButton.removed, index + 1, `${requestField} change removes the stale handler`);

      requests.length = 0;
      readButton.click();
      assert.equal(requests.length, 1);
      assert.equal(requests[0][requestField], expected);
    }
  } finally {
    await act(async () => renderer?.unmount());
  }
});

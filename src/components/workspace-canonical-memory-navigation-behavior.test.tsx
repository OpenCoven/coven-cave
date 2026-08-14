// @ts-nocheck
import { useEffect, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { FamiliarsMemoryView, type MemoryFeed } from "./familiars-memory-view";

const observed = vi.hoisted(() => ({
  renderedMemoryId: null as string | null,
}));
const preferenceDefaults = vi.hoisted(() => ({
  staleOnly: false,
}));

vi.mock("@/components/canonical-memory-reader", () => ({
  CanonicalMemoryReader: ({
    memoryId,
    onBack,
    onMissing,
  }: {
    memoryId: string;
    onBack?: () => void;
    onMissing?: () => void;
  }) => {
    observed.renderedMemoryId = memoryId;
    return (
      <div data-testid="canonical-reader">
        {memoryId}
        <button data-testid="reader-back" onClick={onBack}>Back</button>
        <button data-testid="reader-missing" onClick={onMissing}>Missing</button>
      </div>
    );
  },
  canonicalMemoryErrorCopy: () => ({
    title: "Memory unavailable",
    subtitle: "Try again.",
  }),
}));
vi.mock("@/lib/surface-preferences", async () => {
  const { useState } = await import("react");
  return {
    useSurfacePreference: (spec: {
      key: string;
      defaultValue: unknown;
    }) =>
      useState(
        spec.key === "familiarMemory.staleOnly"
          ? preferenceDefaults.staleOnly
          : spec.defaultValue,
      ),
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const familiar = {
  id: "salem",
  display_name: "Salem",
  role: "familiar",
};
const entry = {
  id: "018f0f77-2f49-7c18-9e52-437b312f8a60",
  familiarId: familiar.id,
  title: "Verified finding",
  updatedAt: "2026-07-27T12:00:00.000Z",
  relativeUpdatedAt: "today",
  excerpt: "A safe summary",
  source: { kind: "canonical", label: "Familiar memory" },
  privacy: { classification: "private", revealRequired: false },
  verification: { state: "verified" },
};
const secondEntry = {
  ...entry,
  id: "018f0f77-2f49-7c18-9e52-437b312f8a61",
  title: "Second verified finding",
};
const fileEntry = {
  fullPath: "/memory/other.md",
  relPath: "other.md",
  modified: "2026-07-27T12:00:00.000Z",
  size: 10,
  sourceKind: "runtime",
  sourceKindLabel: "Runtime memory",
  rootLabel: "Familiar",
  familiarId: familiar.id,
};

function feed(
  state: "loading" | "ready",
  entries = state === "ready" ? [entry] : [],
  files = [],
): MemoryFeed {
  return {
    canonical:
      state === "ready"
        ? { state: "ready", entries }
        : { state: "loading", entries: [] },
    overview: { state: "loading", value: null },
    files: { state: "ready", entries: files },
    lastLoadedAt: null,
    reload: async () => ({ state: "ready", entries: [entry] }),
  };
}

function selectedDetailPaneClass(renderer: ReactTestRenderer): string {
  const pane = renderer.root.find(
    (node) =>
      node.type === "div" &&
      typeof node.props.className === "string" &&
      node.props.className.startsWith("min-h-0 flex-col"),
  );
  return pane.props.className;
}

function canonicalReaderCount(renderer: ReactTestRenderer): number {
  return renderer.root.findAll(
    (node) => node.props["data-testid"] === "canonical-reader",
  ).length;
}

function staleButton(renderer: ReactTestRenderer) {
  const button = renderer.root.findAllByType("button").find(
    (candidate) =>
      candidate.props["aria-pressed"] !== undefined &&
      candidate.children.join("").includes("Stale"),
  );
  expect(button).toBeTruthy();
  return button!;
}

function ParentLikeMemoryLanding({
  request,
  memoryFeed = feed("ready"),
  onApplied,
}: {
  request: { id: string; familiarId: string } | null;
  memoryFeed?: MemoryFeed;
  onApplied: (id: string) => void;
}) {
  const [pendingSelection, setPendingSelection] = useState(request);
  useEffect(() => {
    setPendingSelection(request);
  }, [request]);
  return (
    <>
      <span data-testid="parent-pending">
        {pendingSelection?.id ?? "cleared"}
      </span>
      <FamiliarsMemoryView
        familiars={[familiar]}
        activeFamiliar={familiar}
        localDaemonReady
        lockToFamiliar
        feed={memoryFeed}
        pendingCanonicalMemorySelection={pendingSelection}
        onCanonicalMemorySelectionApplied={(id) => {
          onApplied(id);
          setPendingSelection(null);
        }}
      />
    </>
  );
}

beforeEach(() => {
  preferenceDefaults.staleOnly = false;
});

afterEach(() => {
  observed.renderedMemoryId = null;
  vi.restoreAllMocks();
});

describe("canonical palette handoff into the mounted memory view", () => {
  test("retains a pending row across a settled missing feed, then renders and acknowledges it when the same feed gains the target", async () => {
    const acknowledgements: Array<{
      id: string;
      renderedMemoryId: string | null;
    }> = [];
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <FamiliarsMemoryView
          familiars={[familiar]}
          activeFamiliar={familiar}
          localDaemonReady
          lockToFamiliar
          feed={feed("ready", [])}
          pendingCanonicalMemorySelection={pending}
          onCanonicalMemorySelectionApplied={(id) => {
            acknowledgements.push({
              id,
              renderedMemoryId: observed.renderedMemoryId,
            });
          }}
        />,
      );
    });
    expect(acknowledgements).toEqual([]);
    expect(selectedDetailPaneClass(renderer)).toContain("flex");
    expect(selectedDetailPaneClass(renderer)).not.toContain("hidden");

    await act(async () => {
      renderer.update(
        <FamiliarsMemoryView
          familiars={[familiar]}
          activeFamiliar={familiar}
          localDaemonReady
          lockToFamiliar
          feed={feed("ready")}
          pendingCanonicalMemorySelection={pending}
          onCanonicalMemorySelectionApplied={(id) => {
            acknowledgements.push({
              id,
              renderedMemoryId: observed.renderedMemoryId,
            });
          }}
        />,
      );
    });

    expect(acknowledgements).toEqual([
      { id: entry.id, renderedMemoryId: entry.id },
    ]);
    await act(async () => renderer.unmount());
  });

  test("preserves a blocking search query while applying and acknowledging a pending target", async () => {
    const acknowledgements: string[] = [];
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;
    const render = (request: typeof pending | null) => (
      <ParentLikeMemoryLanding
        request={request}
        onApplied={(id) => acknowledgements.push(id)}
      />
    );

    await act(async () => {
      renderer = create(render(null));
    });
    const search = renderer.root.find(
      (node) =>
        node.type === "input" &&
        node.props.type === "search",
    );
    await act(async () => {
      search.props.onChange({ target: { value: "does-not-match" } });
    });
    expect(observed.renderedMemoryId).toBeNull();

    await act(async () => {
      renderer.update(render(pending));
    });

    expect(
      renderer.root.find(
        (node) =>
          node.type === "input" &&
          node.props.type === "search",
      ).props.value,
    ).toBe("does-not-match");
    expect(canonicalReaderCount(renderer)).toBe(1);
    expect(
      renderer.root.findByProps({ "data-testid": "parent-pending" }).children,
    ).toEqual(["cleared"]);
    expect(acknowledgements).toEqual([entry.id]);
    await act(async () => renderer.unmount());
  });

  test("preserves stale-only while applying and acknowledging a pending canonical target", async () => {
    preferenceDefaults.staleOnly = true;
    const acknowledgements: string[] = [];
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <ParentLikeMemoryLanding
          request={pending}
          onApplied={(id) => acknowledgements.push(id)}
        />,
      );
    });

    expect(canonicalReaderCount(renderer)).toBe(1);
    expect(
      renderer.root.findByProps({ "data-testid": "parent-pending" }).children,
    ).toEqual(["cleared"]);
    expect(acknowledgements).toEqual([entry.id]);
    const staleButton = renderer.root.findAllByType("button").find(
      (button) =>
        button.props["aria-pressed"] !== undefined &&
        button.children.join("").includes("Stale"),
    );
    expect(staleButton?.props["aria-pressed"]).toBe(true);
    await act(async () => renderer.unmount());
  });

  test("a query reactivated while the pending target is absent cannot block its eventual arrival", async () => {
    const acknowledgements: string[] = [];
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;
    const render = (
      entries: typeof entry[],
      selection: typeof pending | null,
    ) => (
      <FamiliarsMemoryView
        familiars={[familiar]}
        activeFamiliar={familiar}
        localDaemonReady
        lockToFamiliar
        feed={feed("ready", entries)}
        pendingCanonicalMemorySelection={selection}
        onCanonicalMemorySelectionApplied={(id) =>
          acknowledgements.push(id)}
      />
    );

    await act(async () => {
      renderer = create(render([], pending));
    });
    const search = renderer.root.find(
      (node) =>
        node.type === "input" &&
        node.props.type === "search",
    );
    await act(async () => {
      search.props.onChange({ target: { value: "does-not-match" } });
    });
    expect(canonicalReaderCount(renderer)).toBe(0);
    expect(acknowledgements).toEqual([]);

    await act(async () => {
      renderer.update(render([entry], pending));
    });
    expect(canonicalReaderCount(renderer)).toBe(1);
    expect(acknowledgements).toEqual([entry.id]);
    expect(
      renderer.root.find(
        (node) =>
          node.type === "input" &&
          node.props.type === "search",
      ).props.value,
    ).toBe("does-not-match");

    await act(async () => {
      renderer.update(render([entry], null));
    });
    expect(canonicalReaderCount(renderer)).toBe(1);
    await act(async () => renderer.unmount());
  });

  test("stale-only reactivated while the pending target is absent cannot block its eventual arrival", async () => {
    const acknowledgements: string[] = [];
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;
    const render = (
      entries: typeof entry[],
      selection: typeof pending | null,
    ) => (
      <FamiliarsMemoryView
        familiars={[familiar]}
        activeFamiliar={familiar}
        localDaemonReady
        lockToFamiliar
        feed={feed("ready", entries)}
        pendingCanonicalMemorySelection={selection}
        onCanonicalMemorySelectionApplied={(id) =>
          acknowledgements.push(id)}
      />
    );

    await act(async () => {
      renderer = create(render([], pending));
    });
    await act(async () => {
      staleButton(renderer).props.onClick();
    });
    expect(staleButton(renderer).props["aria-pressed"]).toBe(true);
    expect(canonicalReaderCount(renderer)).toBe(0);
    expect(acknowledgements).toEqual([]);

    await act(async () => {
      renderer.update(render([entry], pending));
    });
    expect(canonicalReaderCount(renderer)).toBe(1);
    expect(acknowledgements).toEqual([entry.id]);
    expect(staleButton(renderer).props["aria-pressed"]).toBe(true);

    await act(async () => {
      renderer.update(render([entry], null));
    });
    expect(canonicalReaderCount(renderer)).toBe(1);
    await act(async () => renderer.unmount());
  });

  test("a new object for the same ID is a well-defined repeat navigation", async () => {
    const acknowledgements: string[] = [];
    const render = (pending: { id: string; familiarId: string }) => (
      <FamiliarsMemoryView
        familiars={[familiar]}
        activeFamiliar={familiar}
        localDaemonReady
        lockToFamiliar
        feed={feed("ready")}
        pendingCanonicalMemorySelection={pending}
        onCanonicalMemorySelectionApplied={(id) => acknowledgements.push(id)}
      />
    );
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(render({ id: entry.id, familiarId: familiar.id }));
    });
    const search = renderer.root.find(
      (node) =>
        node.type === "input" &&
        node.props.type === "search",
    );
    await act(async () => {
      search.props.onChange({ target: { value: "does-not-match" } });
    });
    observed.renderedMemoryId = null;
    await act(async () => {
      renderer.update(render({ id: entry.id, familiarId: familiar.id }));
    });

    expect(acknowledgements).toEqual([entry.id, entry.id]);
    expect(observed.renderedMemoryId).toBe(entry.id);
    expect(
      renderer.root.find(
        (node) =>
          node.type === "input" &&
          node.props.type === "search",
      ).props.value,
    ).toBe("does-not-match");
    await act(async () => renderer.unmount());
  });

  test("Back clears a successfully applied pin instead of reselecting it", async () => {
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ParentLikeMemoryLanding request={pending} onApplied={() => {}} />,
      );
    });
    expect(canonicalReaderCount(renderer)).toBe(1);

    await act(async () => {
      renderer.root.findByProps({ "data-testid": "reader-back" }).props.onClick();
    });
    expect(canonicalReaderCount(renderer)).toBe(0);
    await act(async () => renderer.unmount());
  });

  test("selecting a different row clears a successfully applied pin", async () => {
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ParentLikeMemoryLanding
          request={pending}
          memoryFeed={feed("ready", [entry], [fileEntry])}
          onApplied={() => {}}
        />,
      );
    });
    expect(canonicalReaderCount(renderer)).toBe(1);
    const fileRow = renderer.root.find(
      (node) =>
        node.props.row?.kind === "file" &&
        node.props.row.path === fileEntry.fullPath,
    );

    await act(async () => fileRow.props.onSelect());
    expect(canonicalReaderCount(renderer)).toBe(0);
    await act(async () => renderer.unmount());
  });

  test("a 404-style missing result clears a successfully applied pin", async () => {
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ParentLikeMemoryLanding request={pending} onApplied={() => {}} />,
      );
    });
    expect(canonicalReaderCount(renderer)).toBe(1);

    await act(async () => {
      renderer.root
        .findByProps({ "data-testid": "reader-missing" })
        .props.onClick();
    });
    expect(canonicalReaderCount(renderer)).toBe(0);
    await act(async () => renderer.unmount());
  });

  test("a settled feed that loses the applied row clears its pin", async () => {
    const pending = { id: entry.id, familiarId: familiar.id };
    let renderer!: ReactTestRenderer;
    const render = (memoryFeed: MemoryFeed) => (
      <ParentLikeMemoryLanding
        request={pending}
        memoryFeed={memoryFeed}
        onApplied={() => {}}
      />
    );
    await act(async () => {
      renderer = create(render(feed("ready")));
    });
    expect(canonicalReaderCount(renderer)).toBe(1);

    await act(async () => {
      renderer.update(render(feed("ready", [])));
    });
    expect(canonicalReaderCount(renderer)).toBe(0);
    await act(async () => renderer.unmount());
  });

  test("a new pending target supersedes the successfully applied pin", async () => {
    const first = { id: entry.id, familiarId: familiar.id };
    const second = { id: secondEntry.id, familiarId: familiar.id };
    const acknowledgements: string[] = [];
    let renderer!: ReactTestRenderer;
    const render = (request: typeof first) => (
      <ParentLikeMemoryLanding
        request={request}
        memoryFeed={feed("ready", [entry, secondEntry])}
        onApplied={(id) => acknowledgements.push(id)}
      />
    );
    await act(async () => {
      renderer = create(render(first));
    });
    expect(canonicalReaderCount(renderer)).toBe(1);

    await act(async () => {
      renderer.update(render(second));
    });
    expect(canonicalReaderCount(renderer)).toBe(1);
    expect(
      renderer.root.findByProps({ "data-testid": "canonical-reader" }).children,
    ).toContain(secondEntry.id);
    expect(acknowledgements).toEqual([entry.id, secondEntry.id]);
    await act(async () => renderer.unmount());
  });
});

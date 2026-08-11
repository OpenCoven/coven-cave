// @ts-nocheck
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CommandPalette } from "./command-palette";

const resources = vi.hoisted(() => ({
  loadCanonical: vi.fn(),
}));

vi.mock("@/lib/canonical-memory-resources", () => ({
  loadCanonicalMemoryList: resources.loadCanonical,
}));
vi.mock("@/lib/use-projects", () => ({
  useProjects: () => ({ projects: [] }),
}));
vi.mock("@/lib/use-focus-trap", () => ({
  useFocusTrap: () => {},
}));
vi.mock("@/lib/datetime-format", () => ({
  useDateTimePrefs: () => {},
}));
vi.mock("@/lib/platform-keys", () => ({
  platformizeHint: (value: string) => value,
  useKeySymbols: () => ({
    up: "up",
    down: "down",
    enter: "enter",
    mod: "cmd",
  }),
}));
vi.mock("@/lib/icon", () => ({
  Icon: () => null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const familiar = {
  id: "salem",
  display_name: "Salem",
  role: "familiar",
};
const canonical = {
  id: "018f0f77-2f49-7c18-9e52-437b312f8a60",
  familiarId: familiar.id,
  title: "Canonical finding",
  updatedAt: "2026-07-27T12:00:00.000Z",
  relativeUpdatedAt: "today",
  excerpt: "Safe canonical summary",
  source: { kind: "canonical", label: "Familiar memory" },
  privacy: { classification: "private", revealRequired: false },
  verification: { state: "verified" },
};
const board = {
  id: "task-1",
  title: "Independent task",
  status: "open",
  priority: "P2",
  familiarId: familiar.id,
  labels: [],
};
const file = {
  root: "/safe",
  rootLabel: "Workspace memory",
  relPath: "independent-note.md",
  fullPath: "/safe/independent-note.md",
  modified: "2026-07-27T12:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

async function mount(
  onIntent: (intent: unknown) => void = () => {},
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <CommandPalette
        open
        onClose={() => {}}
        familiars={[familiar]}
        sessions={[]}
        activeFamiliarId={familiar.id}
        onIntent={onIntent}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function palette(
  open: boolean,
  onIntent: (intent: unknown) => void = () => {},
) {
  return (
    <CommandPalette
      open={open}
      onClose={() => {}}
      familiars={[familiar]}
      sessions={[]}
      activeFamiliarId={familiar.id}
      onIntent={onIntent}
    />
  );
}

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

beforeEach(() => {
  resources.loadCanonical.mockReset();
  globalThis.window = {
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
    setTimeout,
    clearTimeout,
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    getElementById: vi.fn(() => null),
  } as unknown as Document;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  vi.restoreAllMocks();
});

describe("command palette canonical corpus", () => {
  test("shows canonical unavailability while successful board and file corpora remain usable", async () => {
    resources.loadCanonical.mockResolvedValue({
      state: "error",
      error: new Error("canonical unavailable"),
    });
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === "/api/board") {
        return {
          json: async () => ({ ok: true, cards: [board] }),
        } as Response;
      }
      if (String(input) === "/api/memory") {
        return {
          json: async () => ({ ok: true, entries: [file] }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });

    const renderer = await mount();
    const text = textOf(renderer.root);
    expect(text).toContain(
      "Familiar memories unavailable. Other local results are still available.",
    );
    expect(text).toContain(board.title);
    expect(text).toContain(file.relPath);
    await act(async () => renderer.unmount());
  });

  test("a failed file corpus cannot suppress successful canonical and board results", async () => {
    resources.loadCanonical.mockResolvedValue({
      state: "ready",
      entries: [canonical],
    });
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === "/api/board") {
        return {
          json: async () => ({ ok: true, cards: [board] }),
        } as Response;
      }
      if (String(input) === "/api/memory") {
        throw new Error("files unavailable");
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });

    const renderer = await mount();
    const text = textOf(renderer.root);
    expect(text).toContain(canonical.title);
    expect(text).toContain(canonical.familiarId);
    expect(text).toContain(canonical.source.label);
    expect(text).toContain(canonical.verification.state);
    expect(text).toContain(canonical.relativeUpdatedAt);
    expect(text).toContain(canonical.excerpt);
    expect(text).toContain(board.title);
    expect(text).not.toContain("Familiar memories unavailable");
    await act(async () => renderer.unmount());
  });

  test("canonical and file rows emit distinct opaque-ID and path intents", async () => {
    const intents: unknown[] = [];
    resources.loadCanonical.mockResolvedValue({
      state: "ready",
      entries: [canonical],
    });
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === "/api/board") {
        return {
          json: async () => ({ ok: true, cards: [] }),
        } as Response;
      }
      if (String(input) === "/api/memory") {
        return {
          json: async () => ({ ok: true, entries: [file] }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });

    const renderer = await mount((intent) => intents.push(intent));
    const buttons = renderer.root.findAllByType("button");
    const canonicalButton = buttons.find((button) =>
      textOf(button).includes(canonical.title),
    );
    const fileButton = buttons.find((button) =>
      textOf(button).includes(file.relPath),
    );
    expect(canonicalButton).toBeTruthy();
    expect(fileButton).toBeTruthy();

    await act(async () => canonicalButton!.props.onClick());
    await act(async () => fileButton!.props.onClick());

    expect(intents).toEqual([
      {
        kind: "open-coven-memory",
        id: canonical.id,
        familiarId: canonical.familiarId,
      },
      {
        kind: "open-memory-file",
        path: file.fullPath,
      },
    ]);
    await act(async () => renderer.unmount());
  });

  test("unsafe canonical fields neither render nor make the canonical row searchable", async () => {
    const unsafeSentinel = "unsafe-private-canonical-sentinel";
    resources.loadCanonical.mockResolvedValue({
      state: "ready",
      entries: [
        {
          ...canonical,
          updatedAt: unsafeSentinel,
          path: unsafeSentinel,
          content: unsafeSentinel,
          privacy: {
            ...canonical.privacy,
            classification: unsafeSentinel,
            reason: unsafeSentinel,
          },
          verification: {
            ...canonical.verification,
            reason: unsafeSentinel,
          },
        },
      ],
    });
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === "/api/board") {
        return {
          json: async () => ({ ok: true, cards: [] }),
        } as Response;
      }
      if (String(input) === "/api/memory") {
        return {
          json: async () => ({ ok: true, entries: [] }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });

    const renderer = await mount();
    expect(textOf(renderer.root)).toContain(canonical.title);
    expect(textOf(renderer.root)).not.toContain(unsafeSentinel);
    const search = renderer.root.findByType("input");
    await act(async () => {
      search.props.onChange({ target: { value: unsafeSentinel } });
    });
    expect(
      renderer.root
        .findAllByType("button")
        .some((button) => textOf(button).includes(canonical.title)),
    ).toBe(false);
    await act(async () => renderer.unmount());
  });

  test("closing and unmounting cancel every deferred corpus publication", async () => {
    const firstBoard = deferred<Response>();
    const firstCanonical = deferred<{
      state: "ready";
      entries: typeof canonical[];
    }>();
    const firstFiles = deferred<Response>();
    const secondBoard = deferred<Response>();
    const secondCanonical = deferred<{
      state: "ready";
      entries: typeof canonical[];
    }>();
    const secondFiles = deferred<Response>();
    const boardRequests = [firstBoard, secondBoard];
    const fileRequests = [firstFiles, secondFiles];
    resources.loadCanonical
      .mockReturnValueOnce(firstCanonical.promise)
      .mockReturnValueOnce(secondCanonical.promise);
    globalThis.fetch = vi.fn((input) => {
      if (String(input) === "/api/board") {
        return boardRequests.shift()!.promise;
      }
      if (String(input) === "/api/memory") {
        return fileRequests.shift()!.promise;
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(palette(true));
      await Promise.resolve();
    });
    const postCloseErrors: unknown[][] = [];
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args) => postCloseErrors.push(args));

    await act(async () => {
      renderer.update(palette(false));
    });
    await act(async () => {
      firstBoard.resolve({
        json: async () => ({
          ok: true,
          cards: [{ ...board, title: "late closed board" }],
        }),
      } as Response);
      firstCanonical.resolve({
        state: "ready",
        entries: [{ ...canonical, title: "late closed canonical" }],
      });
      firstFiles.resolve({
        json: async () => ({
          ok: true,
          entries: [{ ...file, relPath: "late-closed-file.md" }],
        }),
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      renderer.update(palette(true));
      await Promise.resolve();
    });
    const reopenedText = textOf(renderer.root);
    expect(reopenedText).not.toContain("late closed board");
    expect(reopenedText).not.toContain("late closed canonical");
    expect(reopenedText).not.toContain("late-closed-file.md");

    await act(async () => {
      renderer.unmount();
    });
    await act(async () => {
      secondBoard.resolve({
        json: async () => ({
          ok: true,
          cards: [{ ...board, title: "late unmounted board" }],
        }),
      } as Response);
      secondCanonical.resolve({
        state: "ready",
        entries: [{ ...canonical, title: "late unmounted canonical" }],
      });
      secondFiles.resolve({
        json: async () => ({
          ok: true,
          entries: [{ ...file, relPath: "late-unmounted-file.md" }],
        }),
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(postCloseErrors).toEqual([]);
    errorSpy.mockRestore();
  });
});

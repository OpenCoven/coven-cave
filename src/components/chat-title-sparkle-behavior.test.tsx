// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/icon", () => ({ Icon: () => <span /> }));
vi.mock("@/lib/reasoning-visibility", () => ({
  useShowThinking: () => [false, vi.fn()],
}));
vi.mock("@/lib/thread-instruments-visibility", () => ({
  useThreadInstrumentsVisible: () => [false, vi.fn()],
}));
vi.mock("@/components/project-picker", () => ({
  ProjectPickerPopover: () => null,
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: unknown }) => <>{children}</>,
  PopoverBody: ({ children }: { children: unknown }) => <>{children}</>,
  PopoverItem: ({ children }: { children: unknown }) => <>{children}</>,
  PopoverLabel: ({ children }: { children: unknown }) => <>{children}</>,
  PopoverSeparator: () => null,
}));

import { ChatTitleEditable } from "./chat-session-header";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  id: "session-1",
  title: "Observed title",
  titleRevision: 4,
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function sparkle(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (node) => node.type === "button" && node.props["aria-label"] === "Generate name",
  );
}

function visibleTitle(renderer: ReactTestRenderer): string {
  const title = renderer.root.find(
    (node) => node.type === "button" && node.props.title?.endsWith(" — click to rename"),
  );
  return title.children.join("");
}

async function renderTitle(onSessionsChanged: () => void | Promise<void>) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ChatTitleEditable
        session={session}
        generateTitle={() => "Proposed title"}
        onSessionsChanged={onSessionsChanged}
      />,
    );
  });
  return renderer;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("an ownership-conflict 409 requests one authoritative refresh without displaying the proposal", async () => {
  const refresh = vi.fn(async () => undefined);
  vi.stubGlobal("fetch", vi.fn(async () => response({
    ok: false,
    conflict: true,
    error: "session title changed since it was observed",
    title: "Winning title",
    titleRevision: 5,
  }, 409)));
  const renderer = await renderTitle(refresh);

  await act(async () => {
    sparkle(renderer).props.onClick({ stopPropagation: vi.fn() });
  });

  expect(refresh).toHaveBeenCalledTimes(1);
  expect(visibleTitle(renderer)).toBe("Observed title");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Proposed title");

  await act(async () => {
    renderer.update(
      <ChatTitleEditable
        session={{ ...session, title: "Winning title", titleRevision: 5 }}
        generateTitle={() => "Proposed title"}
        onSessionsChanged={refresh}
      />,
    );
  });
  expect(visibleTitle(renderer)).toBe("Winning title");
});

test("a successful sparkle still refreshes exactly once", async () => {
  const refresh = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => response({
    ok: true,
    title: "Proposed title",
    titleUpdated: true,
  })));
  const renderer = await renderTitle(refresh);

  await act(async () => {
    sparkle(renderer).props.onClick({ stopPropagation: vi.fn() });
  });

  expect(refresh).toHaveBeenCalledTimes(1);
});

test("an unrelated 409 remains an error and does not refresh", async () => {
  const refresh = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => response({
    ok: false,
    error: "different conflict",
  }, 409)));
  const renderer = await renderTitle(refresh);

  await act(async () => {
    sparkle(renderer).props.onClick({ stopPropagation: vi.fn() });
  });

  expect(refresh).not.toHaveBeenCalled();
  expect(visibleTitle(renderer)).toBe("Observed title");
});

test("a malformed conflict response does not masquerade as an authoritative winner", async () => {
  const refresh = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => response({
    ok: false,
    conflict: true,
  }, 409)));
  const renderer = await renderTitle(refresh);

  await act(async () => {
    sparkle(renderer).props.onClick({ stopPropagation: vi.fn() });
  });

  expect(refresh).not.toHaveBeenCalled();
});

test("a late conflict after unmount does not invoke a stale refresh callback", async () => {
  let resolvePatch!: (value: Response) => void;
  const pendingPatch = new Promise<Response>((resolve) => {
    resolvePatch = resolve;
  });
  const refresh = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => pendingPatch));
  const renderer = await renderTitle(refresh);

  await act(async () => {
    sparkle(renderer).props.onClick({ stopPropagation: vi.fn() });
    await Promise.resolve();
  });
  await act(async () => {
    renderer.unmount();
  });
  await act(async () => {
    resolvePatch(response({
      ok: false,
      conflict: true,
      title: "Winning title",
      titleRevision: 5,
    }, 409));
    await pendingPatch;
  });

  expect(refresh).not.toHaveBeenCalled();
});

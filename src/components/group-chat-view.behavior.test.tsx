// @ts-nocheck
import { createElement, Fragment } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const announcer = vi.hoisted(() => ({ announce: vi.fn() }));
const stopRun = vi.hoisted(() => vi.fn(async () => ({ runId: "run", status: 202, state: "accepted" })));
const projectState = vi.hoisted(() => ({
  projects: [{ id: "project-1", name: "Shared Project", root: "/repo" }],
  loading: false,
  error: null,
  loadedSuccessfully: true,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => createElement("button", props, children),
}));
vi.mock("@/components/project-picker", () => ({
  ProjectPicker: () => createElement("div", { "data-testid": "project-picker" }),
}));
vi.mock("@/components/harness-fix-actions", () => ({ HarnessFixActions: () => null }));
vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({ headline, subtitle }) => createElement("div", null, headline, subtitle),
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }) => createElement(Fragment, null, children),
}));
vi.mock("@/components/ui/search-input", () => ({
  SearchInput: ({ value = "", onValueChange, ...props }) =>
    createElement("input", { ...props, value, onChange: (e) => onValueChange?.(e.target.value) }),
}));
vi.mock("@/components/ui/surface-rail", () => ({
  SurfaceRail: ({ children, actions, search }) =>
    createElement("div", null, actions, search, typeof children === "function" ? children(true) : children),
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => async () => true,
}));
vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => announcer,
}));
vi.mock("@/lib/use-stick-to-bottom", () => ({
  useStickToBottom: () => ({
    stuckRef: { current: true },
    schedulePin: () => undefined,
    stick: () => undefined,
  }),
}));
vi.mock("@/components/message-bubble", () => ({
  MessageBubble: ({ content, pending, isError }) =>
    createElement("div", { "data-pending": pending ? "true" : "false", "data-error": isError ? "true" : "false" }, content),
}));
vi.mock("@/components/familiar-avatar", () => ({
  FamiliarAvatar: ({ familiar }) => createElement("span", null, familiar.display_name),
}));
vi.mock("@/components/user-chat-avatar", () => ({
  UserChatAvatar: () => createElement("span", null, "user"),
}));
vi.mock("@/components/ui/relative-time", () => ({
  RelativeTime: () => createElement("span", null, "now"),
}));
vi.mock("@/components/ui/settings-controls", () => ({
  Segmented: () => createElement("div", null, "segmented"),
}));
vi.mock("@/lib/chat-tab-events", () => ({
  consumeCovenGroupPending: () => null,
}));
vi.mock("@/lib/datetime-format", () => ({
  formatChatRecency: () => "now",
  useDateTimePrefs: () => ({}),
}));
vi.mock("@/lib/user-profile", () => ({
  useUserProfile: () => null,
  userDisplayName: () => "Operator",
}));
vi.mock("@/lib/use-group-projects", () => ({
  useGroupProjects: () => projectState,
}));
vi.mock("@/lib/icon", () => ({
  Icon: () => createElement("span", { "aria-hidden": "true" }),
}));
vi.mock("@/lib/chat-stop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-stop")>();
  return {
    ...actual,
    requestChatStopRun: stopRun,
  };
});

import { GroupChatView } from "./group-chat-view";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) => node.type === "button" && textContent(node.children).includes(label),
  );
}

function findCovenRowButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) =>
      node.type === "button" &&
      node.props.className === "coven-tab__rail-row focus-ring" &&
      textContent(node.children).includes(label),
  );
}

function findTextarea(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) => node.type === "textarea" && node.props["aria-label"] === label,
  );
}

function transcriptText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => node.type === "div" && node.props["data-pending"] !== undefined)
    .map((node) => textContent(node.children))
    .join("\n");
}

function makeGroups() {
  return [
    {
      id: "group-a",
      name: "Alpha Coven",
      familiarIds: ["nova"],
      sessions: {},
      projectId: "project-1",
      responseMode: "broadcast",
      nextRoundRobinLeadId: "nova",
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    },
    {
      id: "group-b",
      name: "Beta Coven",
      familiarIds: ["nova"],
      sessions: {},
      projectId: "project-1",
      responseMode: "broadcast",
      nextRoundRobinLeadId: "nova",
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-05T23:59:00.000Z",
    },
  ];
}

function installStorage(options?: { throwOnLatePersist?: boolean }) {
  const data = new Map<string, string>();
  const counts = new Map<string, number>();
  const storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      const nextCount = (counts.get(key) ?? 0) + 1;
      counts.set(key, nextCount);
      if (
        options?.throwOnLatePersist &&
        key === "cave:group-chat:transcript:group-a" &&
        nextCount >= 2
      ) {
        throw new Error("late persist failed");
      }
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
  data.set("cave:group-chat:groups:v1", JSON.stringify(makeGroups()));
  data.set("cave:group-chat:transcript:group-a", JSON.stringify([]));
  data.set("cave:group-chat:transcript:group-b", JSON.stringify([]));
  return { data, storage };
}

beforeEach(() => {
  announcer.announce.mockReset();
  stopRun.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("switching covens while a reply finalizes persists the retired terminal state without mutating the active coven", async () => {
  const { data, storage } = installStorage();
  vi.stubGlobal("window", {
    localStorage: storage,
    setTimeout,
    clearTimeout,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  });
  vi.stubGlobal("localStorage", storage);

  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const encoder = new TextEncoder();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        streams.push(controller);
      },
    }),
  } as Response)));

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(GroupChatView, {
      familiars: [{ id: "nova", display_name: "Nova", role: "Scout" }],
    }));
    await Promise.resolve();
  });

  const textarea = findTextarea(renderer, "Message the Alpha Coven coven");
  await act(async () => {
    textarea.props.onChange({ target: { value: "Hello coven" } });
    await Promise.resolve();
  });
  await act(async () => {
    findButton(renderer, "Send").props.onClick();
    await Promise.resolve();
  });
  await act(async () => {
    streams[0].enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "assistant_chunk", text: "partial" })}\n\n`));
    await Promise.resolve();
  });

  await act(async () => {
    findCovenRowButton(renderer, "Beta Coven").props.onClick();
    await Promise.resolve();
  });

  await act(async () => {
    streams[0].enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "assistant_replace", text: "final saved reply" })}\n\n`));
    streams[0].enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "done", sessionId: "session-a" })}\n\n`));
    streams[0].close();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(transcriptText(renderer)).not.toContain("final saved reply");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(announcer.announce).not.toHaveBeenCalledWith("All 1 familiar replied.");

  const retiredSaved = JSON.parse(data.get("cave:group-chat:transcript:group-a") ?? "[]");
  expect(retiredSaved).toEqual([
    expect.objectContaining({ role: "user", text: "Hello coven" }),
    expect.objectContaining({ role: "assistant", status: "done", text: "final saved reply" }),
  ]);

  await act(async () => {
    findCovenRowButton(renderer, "Alpha Coven").props.onClick();
    await Promise.resolve();
  });

  expect(transcriptText(renderer)).toContain("final saved reply");
});

test("a late retired-scope persistence failure is swallowed and leaves the active coven unchanged", async () => {
  const { storage } = installStorage({ throwOnLatePersist: true });
  vi.stubGlobal("window", {
    localStorage: storage,
    setTimeout,
    clearTimeout,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  });
  vi.stubGlobal("localStorage", storage);

  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const encoder = new TextEncoder();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        streams.push(controller);
      },
    }),
  } as Response)));

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(GroupChatView, {
      familiars: [{ id: "nova", display_name: "Nova", role: "Scout" }],
    }));
    await Promise.resolve();
  });

  await act(async () => {
    findTextarea(renderer, "Message the Alpha Coven coven").props.onChange({ target: { value: "Hello coven" } });
    await Promise.resolve();
  });
  await act(async () => {
    findButton(renderer, "Send").props.onClick();
    await Promise.resolve();
  });
  await act(async () => {
    findCovenRowButton(renderer, "Beta Coven").props.onClick();
    await Promise.resolve();
  });
  await act(async () => {
    streams[0].enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "assistant_replace", text: "late final" })}\n\n`));
    streams[0].enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "done", sessionId: "session-a" })}\n\n`));
    streams[0].close();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(textContent(renderer.toJSON())).toContain("Beta Coven");
  expect(transcriptText(renderer)).not.toContain("late final");
  expect(announcer.announce).not.toHaveBeenCalledWith("All 1 familiar replied.");
});

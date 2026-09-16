// @ts-nocheck
// Behaviour cover for the project-focus latch (PR #5461, review of #5451).
//
// The latch's other tests are latch unit tests plus source-text regexes. Those
// catch the effect being DELETED; they do not catch it being broken — a wrong
// condition or a broken focus helper leaves every regex matching. This drives
// the real component through the state that actually matters: a pending root
// set before mount, rows that arrive later, and the scroll that must follow.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { markProjectFocusPending } from "@/lib/chat-tab-events";
import { ProjectsView } from "./projects-view";

const PROJECT = {
  id: "p-1",
  name: "Cave",
  root: "/Users/x/code/cave",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const state = vi.hoisted(() => ({ loading: true, projects: [] as unknown[] }));

vi.mock("@/lib/use-projects", () => ({
  useProjects: () => ({
    projects: state.projects,
    loading: state.loading,
    error: null,
    reload: vi.fn(),
    createProject: vi.fn(),
    createProjectOrThrow: vi.fn(),
    updateRepoUrl: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
}));
vi.mock("@/lib/use-refresh-on-focus", () => ({ useRefreshOnFocus: vi.fn() }));
vi.mock("@/components/project-picker", () => ({
  useAddProjectFlow: () => ({
    beginAddProject: vi.fn(), addProjectModal: null, adding: false, addError: null,
  }),
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: unknown }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/empty-state", () => ({ EmptyState: () => <div /> }));
vi.mock("@/components/ui/error-state", () => ({ ErrorState: () => <div /> }));
vi.mock("@/components/ui/skeleton", () => ({ SkeletonRows: () => <div /> }));
vi.mock("@/components/ui/select", () => ({
  StandardSelect: (props: Record<string, unknown>) => <select {...props} />,
}));
vi.mock("@/components/project-settings-modal", () => ({ ProjectSettingsModal: () => null }));
vi.mock("@/lib/icon", () => ({ Icon: () => <span /> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let scrolled: string[] = [];

beforeEach(() => {
  state.loading = true;
  state.projects = [];
  scrolled = [];
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    requestAnimationFrame: (cb: FrameRequestCallback) => { cb(0); return 0; },
    setTimeout, clearTimeout, dispatchEvent: () => true,
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  vi.stubGlobal("document", {
    getElementById: (id: string) => ({ scrollIntoView: () => scrolled.push(id) }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as Response));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

test("a focus request made before the rows load is honoured once they arrive", async () => {
  // The cold path: Workspace latched a root, then ChatSurface and ProjectsView
  // mounted lazily while /api/projects was still in flight. Nothing can match
  // the root yet, so the event-based path would drop it here.
  markProjectFocusPending(PROJECT.root);

  let renderer;
  await act(async () => {
    renderer = create(<ProjectsView familiar={null} />);
    await settle();
  });

  expect(scrolled, "nothing can be focused while the rows are still loading").toEqual([]);

  // The fetch settles.
  await act(async () => {
    state.loading = false;
    state.projects = [PROJECT];
    renderer.update(<ProjectsView familiar={null} />);
    await settle();
  });

  expect(
    scrolled,
    "the latched project is scrolled into view once its row exists",
  ).toEqual([`project-access-row:${PROJECT.id}`]);

  // One-shot: a later re-render must not scroll again and yank the viewport
  // away from wherever the user has since moved.
  await act(async () => {
    renderer.update(<ProjectsView familiar={null} />);
    await settle();
  });
  expect(scrolled.length, "the latch fires exactly once").toBe(1);
});

test("a latched root this user cannot see is dropped, not left pending", async () => {
  markProjectFocusPending("/Users/x/code/not-shared");

  let renderer;
  await act(async () => {
    renderer = create(<ProjectsView familiar={null} />);
    await settle();
  });
  await act(async () => {
    state.loading = false;
    state.projects = [PROJECT];
    renderer.update(<ProjectsView familiar={null} />);
    await settle();
  });

  expect(scrolled, "an unmatched root scrolls nothing").toEqual([]);

  // And it must not linger: a later mount with different rows must not suddenly
  // scroll somewhere the user never asked for.
  await act(async () => {
    state.projects = [PROJECT, { ...PROJECT, id: "p-2", root: "/Users/x/code/not-shared" }];
    renderer.update(<ProjectsView familiar={null} />);
    await settle();
  });
  expect(scrolled, "a dropped request does not resurrect later").toEqual([]);
});

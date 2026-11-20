// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { effectiveProjectAccess } from "@/lib/project-permissions";
import { ProjectsView } from "./projects-view";

const observed = vi.hoisted(() => ({
  confirm: vi.fn(),
  announcements: [] as string[],
  listeners: new Map<string, EventListener>(),
  scrollIntoView: vi.fn(),
}));
const projectsState = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; name: string; root: string; repoUrl: string | null }>,
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
  createProject: vi.fn(),
  createProjectOrThrow: vi.fn(),
  updateRepoUrl: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("@/lib/use-projects", () => ({
  useProjects: () => projectsState,
}));
vi.mock("@/lib/use-refresh-on-focus", () => ({ useRefreshOnFocus: vi.fn() }));
vi.mock("@/components/project-picker", () => ({
  useAddProjectFlow: () => ({
    beginAddProject: vi.fn(),
    addProjectModal: null,
    adding: false,
    addError: null,
  }),
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => observed.confirm,
}));
vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({
    announce: (message: string) => observed.announcements.push(message),
  }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: unknown }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/empty-state", () => ({ EmptyState: () => <div /> }));
vi.mock("@/components/ui/error-state", () => ({ ErrorState: () => <div /> }));
vi.mock("@/components/ui/skeleton", () => ({ SkeletonRows: () => <div /> }));
vi.mock("@/components/ui/select", () => ({
  StandardSelect: (props: Record<string, unknown>) => <select {...props} />,
}));
vi.mock("@/components/project-settings-modal", () => ({
  ProjectSettingsModal: () => null,
}));
vi.mock("@/lib/icon", () => ({ Icon: () => <span /> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// #6473: the server gives the supreme familiar no project access beyond its
// real grants, so Projects must show and edit those, never a locked "Full".

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function accessPill(renderer: ReactTestRenderer, projectName: string) {
  const pill = renderer.root
    .findAllByType("button")
    .find((button) => String(button.props["aria-label"] ?? "").startsWith(`${projectName}:`));
  expect(pill, `${projectName} has an access control`).toBeDefined();
  return pill!;
}

const posts: unknown[] = [];
let grants: Array<{ familiarId: string; projectId: string; access: "read" | "write" }> = [];

beforeEach(() => {
  posts.length = 0;
  grants = [];
  observed.announcements.length = 0;
  projectsState.projects = [{ id: "alpha", name: "Alpha", root: "/work/alpha", repoUrl: null }];
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
  });
  vi.stubGlobal("document", { getElementById: () => null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== "/api/project-grants") throw new Error(`Unexpected request: ${url}`);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        grants = [{ familiarId: body.targetFamiliarId, projectId: body.projectId, access: body.access }];
        return response({ ok: true });
      }
      return response({ grants, accessGroups: [], supremeFamiliarId: "nova", privateStateProjectIds: [] });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("a supreme familiar with no grant reads as the server enforces it, and can be granted access", async () => {
  // The server's answer for this familiar and project: no access at all.
  expect(effectiveProjectAccess({ projectGrants: [], accessGroups: [] }, "nova", "alpha").level).toBeNull();

  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ProjectsView familiars={[{ id: "nova", display_name: "Nova", role: "supreme" }]} activeFamiliarId="nova" />,
    );
    await settle();
  });

  const pill = accessPill(renderer!, "Alpha");
  expect(pill.props["aria-label"]).toContain("No access");
  expect(pill.props.disabled).toBeFalsy();
  expect(textContent(renderer!.toJSON())).not.toContain("full access to everything");
  expect(String(pill.props["aria-label"])).not.toContain("Locked");

  await act(async () => {
    pill.props.onClick();
    await settle();
  });
  expect(posts).toEqual([{ targetFamiliarId: "nova", projectId: "alpha", access: "read" }]);
  expect(accessPill(renderer!, "Alpha").props["aria-label"]).toContain("Read");
  expect(effectiveProjectAccess({ projectGrants: grants, accessGroups: [] }, "nova", "alpha").level).toBe("read");
});

// @ts-nocheck
// #6451: the Studio grant matrix on a project whose folder holds Cave's
// private state. The matrix isn't mounted in the app today (Projects renders
// this component's Activity variant), so this drives the component itself:
// granting gives Read, Write isn't offered, a Write grant made before the
// rule is flagged, and a refused level change leaves the grant on.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { FamiliarStudioProjectsTab } from "./familiar-studio-projects-tab";

const ISO = "2026-11-11T09:00:00.000Z";
const PROJECTS = [
  { id: "home", name: "Coven home", root: "/home/cave/.coven", createdAt: ISO },
  { id: "state", name: "Cave state", root: "/home/cave/.coven/cave", createdAt: ISO },
  { id: "app", name: "App", root: "/workspace/app", createdAt: ISO },
];
const REFUSAL = "App (/workspace/app) contains Cave’s private state, so no familiar can have Write access to it. Choose Read instead.";

vi.mock("@/lib/use-projects", () => ({
  useProjects: () => ({
    projects: PROJECTS, createProject: vi.fn(), createProjectOrThrow: vi.fn(),
    renameProject: vi.fn(), deleteProject: vi.fn(), updateRepoUrl: vi.fn(),
  }),
}));
vi.mock("@/components/project-picker", () => ({
  useAddProjectFlow: () => ({ beginAddProject: vi.fn(), addProjectModal: null, adding: false, addError: null }),
}));
vi.mock("@/lib/user-profile", () => ({ useUserProfile: () => null, userDisplayName: () => "You" }));
vi.mock("@/lib/project-access-events", () => ({ publishProjectAccessChanged: vi.fn() }));
vi.mock("@/components/project-settings-modal", () => ({ ProjectSettingsModal: () => null }));
vi.mock("@/components/project-root-workspace-notice", () => ({ ProjectRootWorkspaceNotice: () => null }));
vi.mock("@/components/ui/relative-time", () => ({ RelativeTime: () => null }));
vi.mock("@/components/ui/search-input", () => ({ SearchInput: () => null }));
vi.mock("@/components/ui/icon-button", () => ({ IconButton: () => null }));
vi.mock("@/components/ui/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, leadingIcon: _icon, variant: _variant, size: _size, ...props }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/settings-group", () => ({ SettingsGroup: ({ children }) => <section>{children}</section> }));
vi.mock("@/lib/icon", () => ({ Icon: ({ name }) => <i data-icon={name} /> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let grants;
let requests;
let refuseWrite;

beforeEach(() => {
  grants = [
    { familiarId: "nova", projectId: "home", access: "write", source: "human", grantedAt: ISO },
    { familiarId: "nova", projectId: "app", access: "read", source: "human", grantedAt: ISO },
  ];
  requests = [];
  refuseWrite = false;
  globalThis.fetch = vi.fn(async (url, init) => {
    const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, clone() { return this; } });
    if (!init?.method) {
      if (String(url).startsWith("/api/projects")) return json({ ok: true, projects: PROJECTS });
      if (String(url).startsWith("/api/grant-proposals")) return json({ ok: true, proposals: [] });
      return json({ ok: true, grants, accessGroups: [], supremeFamiliarId: null, audit: [], grantChanges: [], privateStateProjectIds: ["home", "state"] });
    }
    const body = JSON.parse(init.body);
    requests.push({ method: init.method, ...body });
    if (init.method === "POST" && body.access === "write" && refuseWrite) {
      return json({ ok: false, code: "cave_private_state_write", error: REFUSAL }, 409);
    }
    grants = grants.filter((grant) => grant.projectId !== body.projectId);
    if (init.method === "POST") grants.push({ familiarId: "nova", projectId: body.projectId, access: body.access, source: "human", grantedAt: ISO });
    return json({ ok: true });
  });
});

afterEach(() => vi.restoreAllMocks());

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

async function mount() {
  let renderer;
  await act(async () => {
    renderer = create(<FamiliarStudioProjectsTab familiar={{ id: "nova", display_name: "Nova" }} />);
    await settle();
  });
  const root = renderer.root;
  return {
    root,
    grantSwitch: (name) => root.find((node) => node.type === "button" && node.props.role === "switch" && node.props["aria-label"].includes(` ${name} for Nova`)),
    levels: (name) => root.findAll((node) => node.type === "button" && String(node.props["aria-label"] ?? "").startsWith(`Access level for ${name}: `))
      .map((node) => node.props["aria-label"].split(": ")[1]),
    level: (name, label) => root.find((node) => node.type === "button" && node.props["aria-label"] === `Access level for ${name}: ${label}`),
    notes: () => root.findAll((node) => node.type === "p" && node.props["data-private-state"]).map((node) => node.props["data-private-state"]),
    text: () => JSON.stringify(renderer.toJSON()),
  };
}

test("a private-state folder is granted Read, never offered Write, and an old Write is flagged", async () => {
  const tab = await mount();

  // Home has a Write grant from before the rule: flagged, and still narrowable.
  // State has no grant: it says Read only.
  expect(tab.notes()).toEqual(["write", "read-only"]);
  expect(tab.levels("Coven home")).toEqual(["Read", "Read + write"]);
  expect(tab.text()).toContain("Change it to Read.");

  await act(async () => {
    tab.grantSwitch("Cave state").props.onClick();
    await settle();
  });
  expect(requests.at(-1), "the switch asks for Read, the only level this folder can have").toEqual({
    method: "POST", targetFamiliarId: "nova", projectId: "state", access: "read",
  });
  expect(tab.levels("Cave state"), "Write isn't offered").toEqual(["Read"]);

  // An ordinary project still defaults to Write.
  await act(async () => {
    tab.grantSwitch("App").props.onClick();
    await settle();
  });
  expect(requests.at(-1)).toEqual({ method: "DELETE", targetFamiliarId: "nova", projectId: "app" });
  await act(async () => {
    tab.grantSwitch("App").props.onClick();
    await settle();
  });
  expect(requests.at(-1)).toMatchObject({ method: "POST", projectId: "app", access: "write" });
});

test("a refused move from Read to Write leaves the Read grant on and shows the reason", async () => {
  const tab = await mount();
  expect(tab.grantSwitch("App").props["aria-checked"]).toBe(true);
  refuseWrite = true;

  await act(async () => {
    tab.level("App", "Read + write").props.onClick();
    await settle();
  });

  expect(tab.grantSwitch("App").props["aria-checked"], "the grant is still on: the server kept Read").toBe(true);
  expect(tab.levels("App"), "and its level can still be chosen").toEqual(["Read", "Read + write"]);
  expect(tab.text()).toContain(REFUSAL);
});

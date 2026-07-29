// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ProjectsView } from "./projects-view";

const observed = vi.hoisted(() => ({
  confirm: vi.fn(),
  announcements: [] as string[],
}));

vi.mock("@/lib/use-projects", () => ({
  useProjects: () => ({
    projects: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    createProject: vi.fn(),
    updateRepoUrl: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
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

const staleIntegrity = {
  directGrants: 1,
  groupGrants: 0,
  proposals: 0,
  orphanProjectIds: ["removed-project"],
};
const repairedIntegrity = {
  directGrants: 0,
  groupGrants: 0,
  proposals: 0,
  orphanProjectIds: [],
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

function repairButton(renderer: ReactTestRenderer) {
  const button = renderer.root.findAllByType("button").find((candidate) =>
    textContent(candidate.children).includes("Repair stale permissions"),
  );
  expect(button).toBeDefined();
  return button!;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

beforeEach(() => {
  observed.confirm.mockReset();
  observed.confirm.mockResolvedValue(false);
  observed.announcements.length = 0;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("stale-permission repair requires confirmation, mutates once, then refreshes its rendered integrity state", async () => {
  const originalFetch = globalThis.fetch;
  let grantsReads = 0;
  const repairs: RequestInit[] = [];
  let resolveRepair: (value: Response) => void;
  const repairResponse = new Promise<Response>((resolve) => {
    resolveRepair = resolve;
  });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url !== "/api/project-grants") throw new Error(`Unexpected request: ${url}`);
    if (init?.method === "POST") {
      repairs.push(init);
      return await repairResponse;
    }
    grantsReads += 1;
    return response({
      grants: [],
      accessGroups: [],
      supremeFamiliarId: null,
      integrity: grantsReads === 1 ? staleIntegrity : repairedIntegrity,
    });
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(
        <ProjectsView
          familiars={[{ id: "wren", display_name: "Wren", role: "researcher" }]}
          onSessionsDeleted={() => undefined}
        />,
      );
      await settle();
    });

    await act(async () => {
      repairButton(renderer!).props.onClick();
      await settle();
    });
    expect(observed.confirm).toHaveBeenCalledTimes(1);
    expect(repairs).toEqual([]);
    expect(grantsReads).toBe(1);

    observed.confirm.mockResolvedValueOnce(true);
    await act(async () => {
      repairButton(renderer!).props.onClick();
      await settle();
    });

    expect(repairs).toHaveLength(1);
    expect(repairs[0]?.body).toBe(JSON.stringify({ repairOrphans: true }));
    const pendingButton = renderer!.root.findAllByType("button").find((candidate) =>
      textContent(candidate.children).includes("Repairing…"),
    );
    expect(pendingButton?.props.disabled).toBe(true);

    await act(async () => {
      resolveRepair!(response({ ok: true }));
      await settle();
    });

    expect(grantsReads).toBe(2);
    expect(observed.announcements).toContain("Stale project permissions repaired.");
    expect(
      renderer!.root.findAllByType("button").some((candidate) =>
        textContent(candidate.children).includes("Repair stale permissions"),
      ),
    ).toBe(false);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    globalThis.fetch = originalFetch;
  }
});

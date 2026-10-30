// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ProjectSettingsModal } from "./project-settings-modal";

// Confirm folder (#6215): a project with no folder pin can't start chats until
// a person confirms its folder here; a pinned one shows where chats start and
// lets a person confirm a deliberate move.

const announcements = vi.hoisted(() => [] as Array<[string, string | undefined]>);

vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({
    announce: (message: string, politeness?: string) => announcements.push([message, politeness]),
  }),
}));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({ children, footerActions }: { children: unknown; footerActions: unknown }) => (
    <div>
      {children}
      {footerActions}
    </div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, loading, leadingIcon: _leadingIcon, variant: _variant, size: _size, ...props }) => (
    <button data-loading={loading ? "true" : "false"} {...props}>{children}</button>
  ),
}));
vi.mock("@/components/project-avatar", () => ({ ProjectAvatar: () => <span /> }));
vi.mock("@/lib/cave-project-images", () => ({
  clearProjectImage: vi.fn(),
  setProjectImage: vi.fn(),
  useProjectImages: () => ({}),
}));
vi.mock("@/lib/project-icon-actions", () => ({ generateProjectIcon: vi.fn() }));
vi.mock("@/lib/icon", () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const legacy = {
  id: "proj-1",
  name: "Cave",
  root: "/Users/val/code/cave",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let renderer: ReactTestRenderer | null = null;

function render(project, onConfirmRoot) {
  act(() => {
    renderer = create(
      <ProjectSettingsModal
        project={project}
        onClose={vi.fn()}
        onSaveRepoUrl={vi.fn(async () => true)}
        onConfirmRoot={onConfirmRoot}
      />,
    );
  });
  return renderer!;
}

function text(root) {
  return root.root.findAll(() => true)
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join(" ");
}

function button(root, label) {
  return root.root.find((node) => node.type === "button" && node.children.join("") === label);
}

beforeEach(() => {
  announcements.length = 0;
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

test("an unconfirmed project explains the block and confirms its folder", async () => {
  const onConfirmRoot = vi.fn(async () => ({ ok: true }));
  const root = render(legacy, onConfirmRoot);
  expect(text(root)).toContain("Folder not confirmed");
  expect(text(root)).toContain("Chats can’t start in this project until you confirm its folder.");

  await act(async () => {
    button(root, "Confirm folder").props.onClick();
  });

  expect(onConfirmRoot).toHaveBeenCalledWith("proj-1");
  expect(announcements).toEqual([["Folder confirmed.", undefined]]);
});

test("a pinned project names the folder chats start in and offers a deliberate re-confirm", async () => {
  const onConfirmRoot = vi.fn(async () => ({ ok: true }));
  const root = render({ ...legacy, rootRealpath: "/Volumes/Work/cave" }, onConfirmRoot);
  expect(text(root)).toContain("Folder confirmed");
  expect(text(root)).toContain("/Volumes/Work/cave");

  await act(async () => {
    button(root, "Confirm again").props.onClick();
  });
  expect(onConfirmRoot).toHaveBeenCalledWith("proj-1");
});

test("a folder that no longer exists fails with a repair, announced assertively", async () => {
  const root = render(legacy, vi.fn(async () => ({ ok: false, error: "root does not exist" })));

  await act(async () => {
    button(root, "Confirm folder").props.onClick();
  });

  const message = "Couldn’t confirm the folder: it no longer exists. Choose the project’s folder again.";
  expect(root.root.find((node) => node.props.role === "alert").children.join("")).toBe(message);
  expect(announcements).toEqual([[message, "assertive"]]);
});

test("the row stays hidden when the surface wires no confirm handler", () => {
  const root = render(legacy, undefined);
  expect(text(root)).not.toContain("Folder not confirmed");
});

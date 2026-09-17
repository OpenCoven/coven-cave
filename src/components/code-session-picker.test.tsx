// @ts-nocheck — react-test-renderer ships no types; rendered picker behavior test.
import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

import { CodeSessionPicker } from "./code-session-picker";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    open,
    ariaLabel,
    children,
  }: {
    open: boolean;
    ariaLabel?: string;
    children: unknown;
  }) => (open ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null),
  usePopoverInitialFocus: () => {},
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

const QUEUE = {
  reviewableCount: 2,
  allLocalCount: 3,
  outsideCurrentFilter: true,
  sessions: [
    {
      id: "s-new",
      title: "Wire the flux capacitor",
      project_root: "/repo/alpha",
      updated_at: "2026-08-08T10:00:00.000Z",
      status: "running",
      git: { branch: "feat/flux", repositoryUrl: "https://github.com/acme/alpha" },
    },
    {
      id: "s-local",
      title: "Scratchpad session",
      project_root: "/repo/alpha",
      updated_at: "2026-08-08T09:00:00.000Z",
      status: "idle",
      git: { branch: "scratch/local", repositoryUrl: "https://github.com/acme/alpha" },
    },
  ],
  groups: [
    {
      key: "repo:alpha",
      label: "acme/alpha",
      sessions: [],
    },
  ],
};

QUEUE.groups[0].sessions = QUEUE.sessions;

const EMPTY_REVIEWABLE_QUEUE = {
  reviewableCount: 0,
  allLocalCount: 4,
  outsideCurrentFilter: false,
  sessions: [],
  groups: [],
};

describe("CodeSessionPicker neutral landing trigger", () => {
  test("renders Search sessions with no selected session, keeps queue controls, and filters typed queries", async () => {
    const onCreate = vi.fn();
    let renderer;
    await act(async () => {
      renderer = create(
        <CodeSessionPicker
          queue={QUEUE}
          mode="reviewable"
          selected={null}
          onModeChange={() => {}}
          onSelect={() => {}}
          onCreate={onCreate}
        />,
      );
    });

    const trigger = renderer.root.find(
      (node) => node.type === "button" && node.props.className === "focus-ring code-picker__trigger",
    );
    expect(textContent(trigger.children)).toContain("Search sessions");

    await act(async () => trigger.props.onClick());

    expect(textContent(renderer.toJSON())).toContain("Outside current filter");

    const rowsBefore = renderer.root.findAll(
      (node) => node.type === "button" && typeof node.props["data-code-session-id"] === "string",
    );
    expect(rowsBefore.every((row) => row.props["aria-selected"] === false)).toBe(true);

    const input = renderer.root.findByProps({ "data-code-session-search": "" });
    await act(async () => input.props.onChange({ target: { value: "Scratch" } }));

    const rowsAfterFilter = renderer.root.findAll(
      (node) => node.type === "button" && typeof node.props["data-code-session-id"] === "string",
    );
    expect(rowsAfterFilter.map((row) => row.props["data-code-session-id"])).toEqual(["s-local"]);

    await act(async () => input.props.onChange({ target: { value: "Brand new session" } }));
    await act(async () => input.props.onKeyDown({ key: "Enter", preventDefault() {} }));

    expect(onCreate).toHaveBeenCalledWith("Brand new session");

    await act(async () => renderer.unmount());
  });

  test("renders the approved reviewable empty copy after opening an empty picker", async () => {
    let renderer;
    await act(async () => {
      renderer = create(
        <CodeSessionPicker
          queue={EMPTY_REVIEWABLE_QUEUE}
          mode="reviewable"
          selected={null}
          onModeChange={() => {}}
          onSelect={() => {}}
        />,
      );
    });

    const trigger = renderer.root.find(
      (node) => node.type === "button" && node.props.className === "focus-ring code-picker__trigger",
    );

    await act(async () => trigger.props.onClick());

    const empty = renderer.root.find(
      (node) =>
        node.type === "p" &&
        node.props.className === "code-picker__empty-text" &&
        textContent(node.children) === "No GitHub repository sessions need review.",
    );
    expect(textContent(empty.children)).toBe("No GitHub repository sessions need review.");
    expect(textContent(renderer.toJSON())).not.toContain("No reviewable sessions match this scope.");

    await act(async () => renderer.unmount());
  });
});

// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: unknown }) => <>{children}</>,
  PopoverBody: ({ children }: { children: unknown }) => <>{children}</>,
  PopoverItem: ({ children, onSelect }: { children: unknown; onSelect: () => void }) => (
    <button type="button" data-popover-item onClick={onSelect}>{children}</button>
  ),
  PopoverLabel: ({ children }: { children: unknown }) => <span>{children}</span>,
  PopoverSeparator: () => <hr />,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: unknown }) => createElement("button", props, children),
}));
vi.mock("@/components/directory-picker-modal", () => ({ DirectoryPickerModal: () => null }));
vi.mock("@/components/project-avatar", () => ({ ProjectAvatar: () => <span /> }));
vi.mock("@/lib/icon", () => ({ Icon: () => <span /> }));
vi.mock("@/lib/project-frecency", () => ({
  RECENT_SECTION_SIZE: 4,
  loadFrecencyStore: () => ({}),
  rankProjectsByFrecency: () => ({ recent: [] }),
  rememberProjectPick: vi.fn(),
}));
vi.mock("@/lib/chat-add-project", () => ({ addChatProject: vi.fn() }));
vi.mock("@/lib/tauri-platform", () => ({ isTauri: () => false }));

import { ProjectPickerPopover } from "./project-picker";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function itemWithText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const renderedText = (value: ReactTestInstance | string): string => (
    typeof value === "string"
      ? value
      : value.children.map((child) => renderedText(child)).join("")
  );
  return renderer.root.findAllByType("button").find((button) => renderedText(button).includes(text))!;
}

describe("ProjectPickerPopover expansion focus", () => {
  test("keeps the expansion control mounted after revealing every project", async () => {
    const projects = Array.from({ length: 10 }, (_, index) => ({
      id: `project-${index}`,
      name: `Project ${index}`,
      root: `/projects/${index}`,
    }));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ProjectPickerPopover
          open
          onOpenChange={vi.fn()}
          anchorRef={{ current: null }}
          projects={projects}
          value="project-0"
          onChange={vi.fn()}
          ariaLabel="Choose project"
        />,
      );
    });
    const expansionControl = itemWithText(renderer, "Show 2 more projects");

    await act(async () => expansionControl.props.onClick());

    const collapseControl = itemWithText(renderer, "Show fewer projects");
    expect(collapseControl).toBe(expansionControl);
  });
});

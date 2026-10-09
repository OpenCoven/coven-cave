import { createElement, useState, type ReactNode } from "react";
// @ts-expect-error The repository does not ship react-test-renderer declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null,
}));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));

import { BlogDirectionControls } from "./research-blog-directions";
import { EMPTY_BLOG_DIRECTIONS } from "@/lib/research-blog-directions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("searchable selections retain presets and custom entries across closing and reopening", () => {
  let renderer!: ReactTestRenderer;
  function Harness() {
    const [value, onChange] = useState(EMPTY_BLOG_DIRECTIONS);
    return createElement(BlogDirectionControls, { value, onChange });
  }
  act(() => { renderer = create(createElement(Harness)); });
  const trigger = () => renderer.root.findByProps({ "aria-label": "Tone" });
  act(() => trigger().props.onClick());
  const search = () => renderer.root.findByProps({ "aria-label": "Search tone" });
  act(() => search().props.onChange({ target: { value: "tech" } }));
  const checkbox = renderer.root.findByProps({ "aria-label": "Technical" });
  act(() => checkbox.props.onChange());
  expect(renderer.root.findByProps({ "aria-label": "Technical" }).props.checked).toBe(true);
  act(() => search().props.onChange({ target: { value: "Quietly playful" } }));
  act(() => renderer.root.findByProps({ "aria-label": "Add Quietly playful" }).props.onClick());
  act(() => trigger().props.onClick());
  act(() => trigger().props.onClick());
  expect(renderer.root.findByProps({ "aria-label": "Quietly playful" }).props.checked).toBe(true);
  act(() => renderer.root.findByProps({ "aria-label": "Quietly playful" }).props.onChange());
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Technical, Quietly playful');
  act(() => renderer.unmount());
});

test("custom entry accepts Enter and never adds a case-insensitive duplicate", () => {
  let renderer!: ReactTestRenderer;
  const onChange = vi.fn();
  act(() => { renderer = create(createElement(BlogDirectionControls, { value: { ...EMPTY_BLOG_DIRECTIONS, audience: ["Researchers"] }, onChange })); });
  act(() => renderer.root.findByProps({ "aria-label": "Audience" }).props.onClick());
  const search = () => renderer.root.findByProps({ "aria-label": "Search audience" });
  act(() => search().props.onChange({ target: { value: "researchers" } }));
  const preventDefault = vi.fn();
  act(() => search().props.onKeyDown({ key: "Enter", preventDefault }));
  expect(onChange).not.toHaveBeenCalled();
  act(() => search().props.onChange({ target: { value: "Platform engineers" } }));
  act(() => search().props.onKeyDown({ key: "Enter", preventDefault }));
  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BLOG_DIRECTIONS, audience: ["Researchers", "Platform engineers"] });
  expect(preventDefault).toHaveBeenCalled();
  act(() => renderer.unmount());
});

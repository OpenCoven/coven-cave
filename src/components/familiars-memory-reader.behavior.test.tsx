// @ts-nocheck — react-test-renderer has no declarations in this repository.
import React, { useEffect, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryReaderPane } from "./familiars-memory-reader";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/components/document-reader", () => ({ DocumentReader: () => <p>Saved memory</p> }));
vi.mock("@/components/document-reader-markdown", () => ({ MarkdownReaderBlock: () => null }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));
vi.mock("@/components/ui/overflow-menu", () => ({ OverflowMenu: () => null }));
vi.mock("@/lib/use-memory-file", () => ({ useMemoryFile: () => ({ text: "Saved memory", loading: false, error: null }) }));
// A stateful editor isolates the reader's lifetime contract from DOM-only
// CodeMirror/Crepe. Losing this component loses the unsaved user input.
vi.mock("@/components/md-editor/memory-md-editor", () => ({
  MemoryMdEditor: function Editor({ path, onDirtyChange, onCancel, visualLifecycleQueueRef }) {
    const [draft, setDraft] = useState("Saved memory");
    useEffect(() => { onDirtyChange?.(draft !== "Saved memory"); }, [draft, onDirtyChange]);
    return <div data-editor-path={path} data-queue={visualLifecycleQueueRef}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={onCancel}>Cancel editor</button>
      <button onClick={() => setDraft("Saved memory")}>Reset draft</button>
    </div>;
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = undefined; });
const first = { contentPath: "/memory/first.md", path: "/memory/first.md", title: "First", sourceLabel: "Local" };
const second = { ...first, contentPath: "/memory/second.md", path: "/memory/second.md", title: "Second" };
const pane = (row) => <MemoryReaderPane row={row} age="Now" sizeLabel="" onOpenFile={() => {}} onExpand={() => {}} />;
const click = (label) => act(() => renderer.root.findByProps({ "aria-label": label }).props.onClick());
const editor = (path) => renderer.root.findByProps({ "data-editor-path": path });
const typeDraft = (path, value) => act(() => editor(path).findByType("textarea").props.onChange({ target: { value } }));
const update = (row) => act(() => renderer.update(pane(row)));
const draft = (path) => editor(path).findByType("textarea").props.value;

test("Done and Edit preserve unsaved file input", () => {
  act(() => { renderer = create(pane(first)); });
  click("Edit memory file");
  typeDraft(first.path, "Unsaved first draft");
  click("Stop editing");
  expect(editor(first.path).parent.parent.props.hidden).toBe(true);
  click("Edit memory file");
  expect(editor(first.path).parent.parent.props.hidden).toBe(false);
  expect(draft(first.path)).toBe("Unsaved first draft");
});

test("switching rows and clearing selection preserve independent drafts", () => {
  act(() => { renderer = create(pane(first)); });
  click("Edit memory file");
  typeDraft(first.path, "Unsaved first draft");
  update(second);
  click("Edit memory file");
  typeDraft(second.path, "Unsaved second draft");
  update(null);
  update(first);
  click("Edit memory file");
  expect(draft(first.path)).toBe("Unsaved first draft");
  update(second);
  click("Edit memory file");
  expect(draft(second.path)).toBe("Unsaved second draft");
  expect(editor(first.path).props["data-queue"]).not.toBe(editor(second.path).props["data-queue"]);
});

test("leaving a clean editor releases it", () => {
  act(() => { renderer = create(pane(first)); });
  click("Edit memory file");
  click("Stop editing");
  expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
});


test("Cancel returns to reading without discarding an unsaved draft", () => {
  act(() => { renderer = create(pane(first)); });
  click("Edit memory file");
  typeDraft(first.path, "Unsaved first draft");
  act(() => editor(first.path).findAllByType("button").find((button) => button.props.children === "Cancel editor").props.onClick());
  click("Edit memory file");
  expect(draft(first.path)).toBe("Unsaved first draft");
});

test("reverting a draft allows the inactive editor to be released", () => {
  act(() => { renderer = create(pane(first)); });
  click("Edit memory file");
  typeDraft(first.path, "Unsaved first draft");
  click("Stop editing");
  click("Edit memory file");
  typeDraft(first.path, "Saved memory");
  update(second);
  expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
});

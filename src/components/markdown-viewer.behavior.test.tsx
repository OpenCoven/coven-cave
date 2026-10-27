// @ts-nocheck -- react-test-renderer has no bundled types.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("react-dom", () => ({ createPortal: (node) => node, flushSync: (run) => run() }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/lib/use-focus-trap", async (original) => ({ ...await original(), useFocusTrap: () => {} }));
import { Modal } from "./ui/modal";
import { useMarkdownViewer } from "./markdown-viewer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let body;
let first;
let second;
function Owner({ visible = true }) {
  return <Modal open={visible} keepMounted title="Answer" onClose={() => {}}><Content /></Modal>;
}
function Content() {
  const { openViewer, viewer } = useMarkdownViewer();
  return <><button onClick={() => openViewer({ kind: "table", source: first })}>First table</button><button onClick={() => openViewer({ kind: "table", source: second })}>Second table</button>{viewer}</>;
}
function open(label) { act(() => renderer.root.findAllByType("button").find((b) => b.props.children === label).props.onClick()); }
beforeEach(() => {
  vi.stubGlobal("document", { body: {} });
  body = { replaceChildren: vi.fn() };
  first = { cloneNode: vi.fn(() => ({ id: "first clone" })) };
  second = { cloneNode: vi.fn(() => ({ id: "second clone" })) };
  act(() => { renderer = create(<Owner />, { createNodeMock: (element) => element.props.className === "cave-table-lightbox__body cave-md" ? body : null }); });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = null; vi.unstubAllGlobals(); });

test("an injected table opens in a shared Modal beneath its React owner's layer context", () => {
  open("First table");
  const layers = renderer.root.findAllByProps({ className: "ui-modal-backdrop" });
  expect(layers).toHaveLength(2);
  expect(layers[1].props.style.zIndex).toBeGreaterThan(layers[0].props.style.zIndex);
  expect(first.cloneNode).toHaveBeenCalledWith(true);
  expect(body.replaceChildren).toHaveBeenCalledWith({ id: "first clone" });
});

test("reopening replaces the cloned document in one viewer and closing returns to the owner", () => {
  open("First table"); open("Second table");
  expect(renderer.root.findAllByType(Modal)).toHaveLength(2);
  expect(body.replaceChildren).toHaveBeenLastCalledWith({ id: "second clone" });
  act(() => renderer.root.findByProps({ "aria-label": "Close expanded table" }).props.onClick());
  expect(renderer.root.findAllByType(Modal)).toHaveLength(1);
  expect(body.replaceChildren).toHaveBeenLastCalledWith();
});

test("hiding or unmounting the Markdown owner cleans up its viewer", () => {
  open("First table");
  act(() => renderer.update(<Owner visible={false} />));
  expect(renderer.root.findAllByType(Modal)).toHaveLength(1);
  expect(body.replaceChildren).toHaveBeenLastCalledWith();
});

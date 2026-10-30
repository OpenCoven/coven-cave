// @ts-nocheck -- react-test-renderer has no bundled types.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("react-dom", () => ({ createPortal: (node) => node, flushSync: (run) => run() }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/lib/use-focus-trap", async (original) => ({ ...await original(), useFocusTrap: () => {} }));
vi.mock("./mermaid-viewer", () => ({ mountMermaidViewport: vi.fn(), naturalSize: () => ({ w: 640, h: 480 }) }));
vi.mock("./message-bubble", () => ({ MarkdownBlock: () => null }));
vi.mock("./ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));
import { mountMermaidViewport } from "./mermaid-viewer";
import { MessageReader } from "./message-reader";
import { ChatMarkdownReader } from "./chat-markdown-reader";
import { Modal } from "./ui/modal";
import { useMarkdownViewer } from "./markdown-viewer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let body;
let first;
let second;
let diagram;
let disposeDiagram;
function Owner({ visible = true }) {
  return <Modal open={visible} keepMounted title="Answer" onClose={() => {}}><Content /></Modal>;
}
function Content() {
  const { openViewer, viewer } = useMarkdownViewer();
  return <><button onClick={() => openViewer({ kind: "table", source: first })}>First table</button><button onClick={() => openViewer({ kind: "table", source: second })}>Second table</button><button onClick={() => openViewer({ kind: "diagram", source: diagram })}>Diagram</button>{viewer}</>;
}
function open(label) { act(() => renderer.root.findAllByType("button").find((b) => b.props.children === label).props.onClick()); }
beforeEach(() => {
  vi.stubGlobal("document", { body: {} });
  body = { replaceChildren: vi.fn() };
  first = { cloneNode: vi.fn(() => ({ id: "first clone" })) };
  second = { cloneNode: vi.fn(() => ({ id: "second clone" })) };
  diagram = { cloneNode: vi.fn(() => ({ id: "diagram clone" })) };
  disposeDiagram = vi.fn();
  vi.mocked(mountMermaidViewport).mockReset().mockReturnValue(disposeDiagram);
  act(() => { renderer = create(<Owner />, { createNodeMock: (element) => {
    if (element.props.className === "cave-table-lightbox__body cave-md") return body;
    if (element.props.className?.startsWith("cm-mermaid-viewer__") || ["Zoom in", "Zoom out", "Fit to screen"].includes(element.props["aria-label"])) return {};
    return null;
  } }); });
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

test("the first diagram initializes after the hydrated shell mounts its controls and cleans up on close", () => {
  open("Diagram");
  expect(diagram.cloneNode).toHaveBeenCalledWith(true);
  expect(mountMermaidViewport).toHaveBeenCalledTimes(1);
  expect(mountMermaidViewport).toHaveBeenCalledWith({ id: "diagram clone" }, { w: 640, h: 480 }, {
    stage: expect.any(Object), canvas: expect.any(Object), level: expect.any(Object),
    zoomInBtn: expect.any(Object), zoomOutBtn: expect.any(Object), fitBtn: expect.any(Object), close: expect.any(Function),
  });
  act(() => renderer.root.findByProps({ "aria-label": "Close diagram viewer" }).props.onClick());
  expect(disposeDiagram).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType(Modal)).toHaveLength(1);
});

test.each(["message", "document"])("%s reader anchors its first mounted document and disconnects on replacement/unmount", (kind) => {
  act(() => renderer.unmount());
  const headings = [{ id: "" }, { id: "" }];
  const documentNode = { querySelectorAll: vi.fn(() => headings) };
  const observers = [];
  vi.stubGlobal("MutationObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback) { this.callback = callback; observers.push(this); }
  });
  const renderReader = (text) => kind === "message"
    ? <MessageReader text={text} label="Review" onClose={() => {}}><h1>First</h1><h2>Second</h2></MessageReader>
    : <ChatMarkdownReader markdown={text} title="Review" eyebrow="Project" noun="document" subject="Document" fallbackFilename="review" onClose={() => {}} />;
  act(() => { renderer = create(renderReader("# First\n\n## Second"), { createNodeMock: element => {
    if (element.props.className === "cave-reader-doc" || element.props.className === "chat-spec-reader__document focus-ring-inset") return documentNode;
    return null;
  } }); });
  expect(headings.every(heading => heading.id.length > 0)).toBe(true);
  expect(new Set(headings.map(heading => heading.id)).size).toBe(2);
  expect(observers).toHaveLength(1);
  expect(observers[0].observe).toHaveBeenCalledWith(documentNode, { childList: true, subtree: true });
  act(() => renderer.update(renderReader("# Replacement\n\n## Updated")));
  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  expect(observers).toHaveLength(2);
  headings[0].id = "";
  act(() => observers[1].callback());
  expect(headings[0].id.length).toBeGreaterThan(0);
  act(() => renderer.unmount()); renderer = null;
  expect(observers[1].disconnect).toHaveBeenCalledTimes(1);
});

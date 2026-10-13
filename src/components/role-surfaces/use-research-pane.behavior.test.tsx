// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useResearchPane } from "./use-research-pane";
let tree;
const options = { storageKey: "test-pane", min: 230, max: 440, initial: 296, direction: 1 };
function Pane() {
  const pane = useResearchPane(options);
  return <div {...pane.separatorProps} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { localStorage: { getItem: () => "320", setItem: vi.fn() } });
  vi.stubGlobal("document", { body: { style: { cursor: "default", userSelect: "text", removeProperty(key) { this[key] = ""; } } } });
});
afterEach(() => { act(() => tree?.unmount()); vi.unstubAllGlobals(); });
function start() {
  act(() => { tree = create(<Pane />); });
  const target = new EventTarget();
  target.setPointerCapture = vi.fn(); target.hasPointerCapture = () => true;
  target.releasePointerCapture = vi.fn();
  act(() => tree.root.findByType("div").props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, currentTarget: target, preventDefault() {} }));
  return target;
}
test("unmount during resize releases capture and restores previous body styles", () => {
  const target = start();
  expect(document.body.style.cursor).toBe("col-resize");
  act(() => tree.unmount()); tree = null;
  expect(document.body.style.cursor).toBe("default");
  expect(document.body.style.userSelect).toBe("text");
  expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
});
test("removing only the separator ends a drag while the pane stays mounted", () => {
  const target = start();
  // React detaches the ref when a conditional separator disappears. The
  // owning Desk hook remains mounted, so its effect cleanup does not run.
  act(() => tree.root.findByType("div").props.ref?.(null));
  expect(document.body.style.cursor).toBe("default");
  expect(document.body.style.userSelect).toBe("text");
  expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
});
test("lost pointer capture ends resizing and keyboard sizing remains bounded", () => {
  const target = start();
  act(() => target.dispatchEvent(new Event("lostpointercapture")));
  expect(document.body.style.cursor).toBe("default");
  const key = key => act(() => tree.root.findByType("div").props.onKeyDown({ key, preventDefault() {} }));
  key("End"); key("ArrowRight");
  expect(tree.root.findByType("div").props["aria-valuenow"]).toBe(440);
  key("Home"); key("ArrowLeft");
  expect(tree.root.findByType("div").props["aria-valuenow"]).toBe(230);
  expect(window.localStorage.setItem).toHaveBeenLastCalledWith("test-pane", "230");
});

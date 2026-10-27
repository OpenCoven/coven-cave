// @ts-nocheck -- react-test-renderer has no bundled types.
import { useEffect, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("react-dom", () => ({ createPortal: (children) => children }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
import { Modal } from "./modal";
import { ChatBroadcastComposer } from "../chat-broadcast-composer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let active;
let listeners;
let controls;
let container;
let opener;

function node(name) {
  const result = {
    name, tabIndex: 0,
    focus: () => { active = result; },
    hasAttribute: () => false, matches: () => false,
    getClientRects: () => [{ width: 1, height: 1 }],
  };
  return result;
}
function key(key, shiftKey = false) {
  const event = { key, shiftKey, preventDefault: vi.fn(), stopImmediatePropagation() { this.stopped = true; } };
  for (const listener of listeners.get("keydown") ?? []) {
    listener(event);
    if (event.stopped) break;
  }
  return event;
}
function mount(props = {}) {
  act(() => {
    renderer = create(<Modal open breadcrumb={["Tasks", "New task"]} onClose={() => {}} {...props}><input /></Modal>, {
      createNodeMock: (element) => element.props.role === "dialog" ? container : null,
    });
  });
}
function closeButton() { return renderer.root.findByProps({ "aria-label": "Close" }); }
function backdrop() { return renderer.root.findByProps({ role: "presentation" }); }

beforeEach(() => {
  listeners = new Map();
  opener = node("opener"); active = opener;
  controls = [node("first"), node("last")];
  container = {
    querySelector: () => controls[0], querySelectorAll: () => controls,
    contains: (target) => controls.includes(target), focus: () => { active = container; },
  };
  vi.stubGlobal("document", { body: { style: {}, children: [] }, documentElement: { style: {} }, querySelectorAll: () => [], get activeElement() { return active; } });
  vi.stubGlobal("window", {
    addEventListener: (name, listener) => { listeners.set(name, [...(listeners.get(name) ?? []), listener]); },
    removeEventListener: (name, listener) => { listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== listener)); },
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

test("busy blocks every user dismissal while keeping keyboard focus contained", () => {
  const onClose = vi.fn();
  mount({ busy: true, onClose });
  act(() => {
    closeButton().props.onClick();
    backdrop().props.onClick?.();
    key("Escape");
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(closeButton().props.disabled).toBe(true);
  controls[1].focus();
  expect(key("Tab").preventDefault).toHaveBeenCalledOnce();
  expect(active).toBe(controls[0]);
});

test("a required gate has no close affordance and cannot dismiss through Escape or backdrop", () => {
  const onClose = vi.fn();
  mount({ dismissible: false, onClose });
  act(() => { backdrop().props.onClick?.(); key("Escape"); });
  expect(onClose).not.toHaveBeenCalled();
  expect(renderer.root.findAllByProps({ "aria-label": "Close" })).toHaveLength(0);
});

test("dismissal reasons distinguish Escape, backdrop, and close without releasing focus early", () => {
  const onClose = vi.fn();
  mount({ onClose });
  act(() => { key("Escape"); backdrop().props.onClick(); closeButton().props.onClick(); });
  expect(onClose.mock.calls).toEqual([["escape"], ["backdrop"], ["close"]]);
  expect(active).toBe(controls[0]);
  act(() => renderer.unmount()); renderer = null;
  expect(active).toBe(opener);
});

test("plain titles and short descriptions label the dialog; an empty breadcrumb does not mask the title", () => {
  mount({ breadcrumb: [], title: "Delete project?", description: "Chats remain available." });
  const dialog = renderer.root.findByProps({ role: "dialog" });
  const title = renderer.root.findByProps({ id: dialog.props["aria-labelledby"] });
  expect(title.children).toContain("Delete project?");
  const description = renderer.root.findByProps({ id: dialog.props["aria-describedby"] });
  expect(description.children).toContain("Chats remain available.");
});

test("initial focus can select the least destructive action and restoration can yield to navigation", () => {
  mount({ initialFocusRef: { current: controls[1] }, restoreFocus: () => false });
  expect(active).toBe(controls[1]);
  const destination = node("task-list"); destination.focus();
  act(() => renderer.unmount()); renderer = null;
  expect(active).toBe(destination);
});

test("explicit size and presentation share fill content", () => {
  mount({ size: "reader", presentation: "sheet-right", bodyLayout: "fill" });
  const dialog = renderer.root.findByProps({ role: "dialog" });
  expect(dialog.props["data-size"]).toBe("reader");
  expect(backdrop().props["data-presentation"]).toBe("sheet-right");
  expect(renderer.root.findByProps({ className: "ui-modal-body" }).props["data-layout"]).toBe("fill");
});

test("broadcast names its dialog from the visible heading and retains the draft after a failed send", async () => {
  let finish;
  vi.stubGlobal("fetch", () => new Promise((resolve) => { finish = resolve; }));
  const onClose = vi.fn();
  act(() => {
    renderer = create(<ChatBroadcastComposer count={2} targets={["one", "two"]} onClose={onClose} onSent={() => {}} />, {
      createNodeMock: (element) => element.props.role === "dialog" ? container : controls[0],
    });
  });
  const dialog = renderer.root.findByProps({ role: "dialog" });
  expect(dialog.props["aria-labelledby"]).toBeTruthy();
  const title = renderer.root.findByProps({ id: dialog.props["aria-labelledby"] });
  expect(title.children.join("")).toBe("Broadcast to 2 chats");
  act(() => renderer.root.findByType("textarea").props.onChange({ target: { value: "Keep this draft" } }));
  act(() => renderer.root.findAllByType("button").find((b) => b.children.join("").includes("Send to 2")).props.onClick());
  act(() => { closeButton().props.onClick(); key("Escape"); });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { finish({ ok: false, status: 503, json: async () => ({ error: "Try again" }) }); });
  expect(renderer.root.findByType("textarea").props.value).toBe("Keep this draft");
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("Try again");
  expect(onClose).not.toHaveBeenCalled();
});

test("retained content survives close, but its hidden layer cannot keep focus or cover native panes", () => {
  let mounts = 0;
  function Draft() {
    const [value, setValue] = useState("");
    useEffect(() => { mounts += 1; }, []);
    return <input value={value} onChange={(event) => setValue(event.target.value)} />;
  }
  const render = (open) => <Modal open={open} keepMounted title="Chat" onClose={() => {}}><Draft /></Modal>;
  act(() => { renderer = create(render(true), { createNodeMock: (element) => element.props.role === "dialog" ? container : null }); });
  act(() => renderer.root.findByType("input").props.onChange({ target: { value: "Unsent draft" } }));
  act(() => renderer.update(render(false)));
  expect(backdrop().props.hidden).toBe(true);
  expect(backdrop().props.inert).toBe(true);
  expect(renderer.root.findByProps({ role: "dialog" }).props["aria-modal"]).toBeUndefined();
  expect(active).toBe(opener);
  const outside = node("outside"); outside.focus();
  expect(key("Tab").preventDefault).not.toHaveBeenCalled();
  act(() => renderer.update(render(true)));
  expect(mounts).toBe(1);
  expect(renderer.root.findByType("input").props.value).toBe("Unsent draft");
});

test("a covered dialog yields focus without unmounting or stealing it back from diagnostics", () => {
  const onClose = vi.fn();
  mount({ onClose });
  const diagnostics = node("diagnostics"); diagnostics.focus();
  act(() => renderer.update(<Modal open covered title="Setup" onClose={onClose}><input /></Modal>));
  expect(active).toBe(diagnostics);
  expect(renderer.root.findByProps({ role: "dialog" }).props.inert).toBe(true);
  expect(key("Escape").preventDefault).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("nested modal paint order matches focus depth even when both mount together", () => {
  act(() => {
    renderer = create(<Modal open title="Parent" onClose={() => {}}><Modal open title="Child" onClose={() => {}}>Source</Modal></Modal>, {
      createNodeMock: (element) => element.props.role === "dialog" ? container : null,
    });
  });
  const [parent, child] = renderer.root.findAllByProps({ className: "ui-modal-backdrop" });
  expect(child.props.style?.zIndex).toBeGreaterThan(parent.props.style?.zIndex);
});

test("a later independent modal paints above a nested dialog from an earlier root", () => {
  function Layers({ second = false }) {
    return <><Modal open title="Parent" onClose={() => {}}><Modal open title="Child" onClose={() => {}}>Source</Modal></Modal>{second ? <Modal open title="New root" onClose={() => {}}>New</Modal> : null}</>;
  }
  act(() => { renderer = create(<Layers />, { createNodeMock: (element) => element.props.role === "dialog" ? container : null }); });
  act(() => { renderer.update(<Layers second />); });
  const layers = renderer.root.findAllByProps({ className: "ui-modal-backdrop" });
  expect(layers[2].props.style?.zIndex).toBeGreaterThan(layers[1].props.style?.zIndex);
});

test("hiding a retained owner dismisses an idle nested dialog and leaves its busy draft mounted", () => {
  const onIdleClose = vi.fn();
  const onBusyClose = vi.fn();
  const render = (open, busy = true) => <Modal open={open} keepMounted title="Chat" onClose={() => {}}>
    <Modal open title="Idle child" onClose={onIdleClose}>Idle</Modal>
    <Modal open busy={busy} keepMounted title="Sending child" onClose={onBusyClose}>Draft</Modal>
  </Modal>;
  act(() => { renderer = create(render(true), { createNodeMock: (element) => element.props.role === "dialog" ? container : null }); });
  act(() => { renderer.update(render(false)); });
  expect(onIdleClose).toHaveBeenCalledOnce();
  expect(onBusyClose).not.toHaveBeenCalled();
  expect(renderer.root.findAllByProps({ className: "ui-modal-backdrop" }).every((layer) => layer.props.hidden)).toBe(true);
  act(() => { renderer.update(render(false, false)); });
  expect(onBusyClose).toHaveBeenCalledOnce();
});


test("backdrop pointer override is guarded and never receives content presses", () => {
  const onBackdropPress = vi.fn();
  mount({onBackdropPress});
  const target = {};
  act(() => backdrop().props.onPointerDown({target: {}, currentTarget: target}));
  expect(onBackdropPress).not.toHaveBeenCalled();
  act(() => backdrop().props.onPointerDown({target, currentTarget: target}));
  expect(onBackdropPress).toHaveBeenCalledOnce();
  act(() => renderer.update(<Modal open title="Busy" onClose={() => {}} onBackdropPress={onBackdropPress} busy><input /></Modal>));
  expect(backdrop().props.onPointerDown).toBeUndefined();
  expect(backdrop().props.onClick).toBeUndefined();
});

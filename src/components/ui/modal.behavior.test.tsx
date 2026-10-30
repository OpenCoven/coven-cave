// @ts-nocheck -- react-test-renderer has no bundled types.
import { useContext, useEffect, useLayoutEffect, useState } from "react";
import { act, create } from "react-test-renderer";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("react-dom", () => ({ createPortal: (children) => children }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
import { Modal } from "./modal";
import { ChatBroadcastComposer } from "../chat-broadcast-composer";
import { FocusTrapOwnerHiddenContext } from "@/lib/use-focus-trap";

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

test("native focus boundaries wrap without selecting themselves", () => {
  mount();
  const start = renderer.root.findByProps({ "data-focus-trap-guard": "start" });
  const end = renderer.root.findByProps({ "data-focus-trap-guard": "end" });
  expect(start.props.tabIndex).toBe(0);
  expect(end.props.tabIndex).toBe(0);
  controls[1].focus();
  act(() => end.props.onFocus({ relatedTarget: null }));
  expect(active).toBe(controls[0]);
  act(() => start.props.onFocus({ relatedTarget: null }));
  expect(active).toBe(controls[1]);
});

test("covered modal boundaries cannot steal the active layer's focus", () => {
  mount({ covered: true });
  const end = renderer.root.findByProps({ "data-focus-trap-guard": "end" });
  expect(end.props.tabIndex).toBe(-1);
  opener.focus();
  act(() => end.props.onFocus({ relatedTarget: null }));
  expect(active).toBe(opener);
});

for (const scope of ["viewport", "container"] as const) {
  for (const open of [true, false]) {
    test(`${scope} ${open ? "open" : "retained closed"} modal matches empty server output until hydration commits`, () => {
      const clientDocument = document;
      vi.stubGlobal("document", undefined);
      try {
        expect(renderToString(<Modal open={open} keepMounted scope={scope} title="Initial dialog" onClose={() => {}}>Content</Modal>)).toBe("");
      } finally {
        vi.stubGlobal("document", clientDocument);
      }
      const onLayerElement = vi.fn();
      let firstCommitLayerCalls = -1;
      function InitialFrame() {
        useLayoutEffect(() => { firstCommitLayerCalls = onLayerElement.mock.calls.length; }, []);
        return <Modal open={open} keepMounted scope={scope} title="Initial dialog" onClose={() => {}} onLayerElement={onLayerElement}>Content</Modal>;
      }
      act(() => {
        renderer = create(<InitialFrame />, {
          createNodeMock: (element) => element.props.role === "dialog" ? container : null,
        });
      });
      expect(firstCommitLayerCalls).toBe(0);
      expect(onLayerElement).toHaveBeenCalled();
      expect(backdrop().props.hidden).toBe(!open);
      expect(active).toBe(open ? controls[0] : opener);
    });
  }
}

beforeEach(() => {
  listeners = new Map();
  opener = node("opener"); active = opener;
  controls = [node("first"), node("last")];
  container = {
    querySelector: () => controls[0], querySelectorAll: () => controls,
    contains: (target) => controls.includes(target), focus: () => { active = container; },
  };
  vi.stubGlobal("document", { body: { ...node("body"), style: {}, children: [] }, documentElement: { style: {} }, querySelectorAll: () => [], get activeElement() { return active; } });
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

test("inline children retain state and stay interactive when the same host returns from fullscreen", () => {
  const host = { className: "", parentNode: null, remove: vi.fn() };
  const slot = { appendChild: vi.fn((child) => { child.parentNode = slot; }) };
  document.createElement = vi.fn(() => host);
  document.body.appendChild = vi.fn((child) => { child.parentNode = document.body; });
  let mounts = 0;
  function Content() {
    const [draft, setDraft] = useState("");
    const hidden = useContext(FocusTrapOwnerHiddenContext);
    useEffect(() => { mounts++; }, []);
    return <input data-inline-content hidden={hidden} value={draft} onChange={(event) => setDraft(event.target.value)} />;
  }
  const view = (open) => <Modal open={open} inlineWhenClosed title="Retained editor" onClose={() => {}}><Content /></Modal>;
  act(() => {
    renderer = create(view(false), {
      createNodeMock: (element) => element.props["data-body-layout"] ? container : element.props.className === "flex h-full min-h-0 min-w-0 flex-1" ? slot : null,
    });
  });
  const input = () => renderer.root.findByProps({ "data-inline-content": true });
  expect(host.parentNode).toBe(slot);
  expect(input().props.hidden).toBe(false);
  expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  act(() => input().props.onChange({ target: { value: "Unsaved editor state" } }));
  for (const open of [true, false, true, false]) {
    act(() => renderer.update(view(open)));
    expect(host.parentNode).toBe(open ? document.body : slot);
    expect(input().props.hidden).toBe(false);
    expect(input().props.value).toBe("Unsaved editor state");
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(open ? 1 : 0);
    expect(mounts).toBe(1);
  }
  act(() => renderer.unmount()); renderer = null;
  expect(host.remove).toHaveBeenCalledOnce();
});

test("a retained covered modal preserves its original opener across reactivation", () => {
  mount();
  for (let round = 0; round < 2; round++) {
    controls[1].focus();
    act(() => renderer.update(<Modal open covered onClose={() => {}}><input /></Modal>));
    expect(active).toBe(controls[1]);
    act(() => renderer.update(<Modal open onClose={() => {}}><input /></Modal>));
    controls[1].focus();
  }
  act(() => renderer.unmount()); renderer = null;
  expect(active).toBe(opener);
});

test("closing a covered retained modal releases its opener before reopening", () => {
  mount({ keepMounted: true });
  act(() => renderer.update(<Modal open covered keepMounted onClose={() => {}}><input /></Modal>));
  act(() => renderer.update(<Modal open={false} covered keepMounted onClose={() => {}}><input /></Modal>));
  const nextOpener = node("next-retained-opener");
  nextOpener.focus();
  act(() => renderer.update(<Modal open keepMounted onClose={() => {}}><input /></Modal>));
  act(() => renderer.update(<Modal open={false} keepMounted onClose={() => {}}><input /></Modal>));
  expect(active).toBe(nextOpener);
});

test("a fully disposed modal root captures a new opener when reopened", () => {
  mount();
  act(() => renderer.unmount()); renderer = null;
  expect(active).toBe(opener);
  const nextOpener = node("next-opener");
  nextOpener.focus();
  mount();
  act(() => renderer.unmount()); renderer = null;
  expect(active).toBe(nextOpener);
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

test("pending mutation recaptures focus after the browser blurs a disabled action to body", () => {
  mount();
  active = document.body;
  controls = [];
  act(() => renderer.update(<Modal open busy onClose={() => {}}><input disabled /></Modal>));
  expect(active).toBe(container);
});

test.each([false, true])("an empty trap recaptures escaped focus on Tab (backward=%s)", (backward) => {
  mount();
  controls = [];
  active = document.body;
  expect(key("Tab", backward).preventDefault).toHaveBeenCalledOnce();
  expect(active).toBe(container);
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

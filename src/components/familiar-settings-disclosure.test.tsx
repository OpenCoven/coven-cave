// @ts-expect-error -- This existing test dependency does not ship declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FamiliarSettingsDisclosure } from "./familiar-settings-disclosure";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
let tree: ReactTestRenderer;
const focus = vi.fn();
const mounts = vi.fn();
function Editor() {
  const [draft, setDraft] = useState("");
  useEffect(() => { mounts(); }, []);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  focus.mockClear(); mounts.mockClear();
});
afterEach(() => { act(() => tree?.unmount()); vi.unstubAllGlobals(); });
function render(reveal = false) {
  act(() => {
    tree = create(<FamiliarSettingsDisclosure title="Appearance" description="Optional editor" reveal={reveal}><Editor /></FamiliarSettingsDisclosure>, {
      createNodeMock: (element: { type: string }) => element.type === "button" ? { focus } : null,
    });
  });
}

test("optional editor does no mount work until intent and retains its draft across collapse", () => {
  render();
  expect(mounts).not.toHaveBeenCalled();
  act(() => tree.root.findByType("button").props.onClick());
  expect(mounts).toHaveBeenCalledTimes(1);
  act(() => tree.root.findByType("input").props.onChange({ target: { value: "unfinished" } }));
  act(() => tree.root.findByType("button").props.onClick());
  expect(tree.root.findByType("input").props.value).toBe("unfinished");
  act(() => tree.root.findByType("button").props.onClick());
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType("input").props.value).toBe("unfinished");
});

test("Escape closes the group and returns focus, but honors a child consuming Escape", () => {
  render(true);
  const key = (defaultPrevented: boolean) => ({ key: "Escape", defaultPrevented, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  act(() => tree.root.findByType("section").props.onKeyDown(key(true)));
  expect(tree.root.findByType("button").props["aria-expanded"]).toBe(true);
  act(() => tree.root.findByType("section").props.onKeyDown(key(false)));
  expect(tree.root.findByType("button").props["aria-expanded"]).toBe(false);
  expect(focus).toHaveBeenCalledOnce();
});

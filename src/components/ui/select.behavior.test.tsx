// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { StandardSelect } from "./select";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/components/ui/popover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/popover")>()),
  Popover: ({ open, children }) => open ? children : null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

test("keyboard opening enters the menu; arrows skip disabled options, wrap, and select", () => {
  let activeElement = null;
  const options = ["First", "Unavailable", "Last"].map((name, index) => ({
    name, disabled: index === 1, focus() { activeElement = this; },
  }));
  const menu = {
    querySelector: () => options[0],
    querySelectorAll: (selector) => selector.includes(":not(:disabled)")
      ? options.filter((option) => !option.disabled) : options,
  };
  vi.stubGlobal("document", { get activeElement() { return activeElement; }, querySelector: () => menu });
  vi.stubGlobal("requestAnimationFrame", (callback) => { callback(); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const change = vi.fn();
  act(() => {
    renderer = create(<StandardSelect label="Voice" value="first" onChange={change} options={[
      { value: "first", label: "First" },
      { value: "unavailable", label: "Unavailable", disabled: true },
      { value: "last", label: "Last" },
    ]} />);
  });
  const trigger = renderer.root.findByProps({ "aria-label": "Voice" });
  act(() => trigger.props.onClick({ detail: 0 }));
  expect(activeElement).toBe(options[0]);
  const press = (key) => {
    const body = renderer.root.findByProps({ role: "menu" });
    act(() => body.props.onKeyDown({ key, currentTarget: menu, preventDefault() {}, stopPropagation() {} }));
  };
  press("ArrowDown");
  expect(activeElement).toBe(options[2]);
  press("ArrowDown");
  expect(activeElement).toBe(options[0]);
  press("ArrowUp");
  expect(activeElement).toBe(options[2]);
  press("Home");
  expect(activeElement).toBe(options[0]);
  press("End");
  expect(activeElement).toBe(options[2]);
  // Activate the enabled final option as a native Enter click would.
  const finalOption = renderer.root.findAllByType("button").filter((button) => button.props.role === "menuitemradio").at(-1);
  act(() => finalOption.props.onClick());
  expect(change).toHaveBeenCalledWith("last");
  expect(trigger.props["aria-expanded"]).toBe(false);
});

test("pointer opening retains trigger focus and ArrowDown can enter a closed menu", () => {
  const first = { focus: vi.fn() };
  vi.stubGlobal("document", { querySelector: () => ({ querySelector: () => first }) });
  vi.stubGlobal("requestAnimationFrame", (callback) => { callback(); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    renderer = create(<StandardSelect label="Voice" value="first" onChange={() => {}} options={[{ value: "first", label: "First" }]} />);
  });
  const trigger = renderer.root.findByProps({ "aria-label": "Voice" });
  act(() => trigger.props.onClick({ detail: 1 }));
  expect(first.focus).not.toHaveBeenCalled();
  act(() => trigger.props.onClick({ detail: 1 }));
  act(() => trigger.props.onKeyDown({ key: "ArrowDown", preventDefault() {} }));
  expect(first.focus).toHaveBeenCalledOnce();
});

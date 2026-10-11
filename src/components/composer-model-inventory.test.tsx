// @ts-nocheck
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ComposerModelPopover } from "./composer-runtime-chip";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/components/runtime-logo", () => ({ RuntimeLogo: () => null, runtimeDisplayName: (runtime) => runtime }));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, children }) => open ? children : null,
  PopoverBody: ({ children }) => children,
  PopoverLabel: ({ children }) => createElement("span", null, children),
  PopoverItem: ({ children, onSelect, disabled }) => createElement("button", { onClick: onSelect, disabled }, children),
  PopoverSeparator: () => null,
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
const text = () => JSON.stringify(renderer.toJSON());
async function render(runtime, inventory = {}) {
  const onPickModel = vi.fn();
  const onOpenChange = vi.fn();
  const refresh = vi.fn();
  await act(async () => {
    renderer = create(createElement(ComposerModelPopover, {
      open: true, runtime, modelValue: "selected-model", modelOptions: [],
      anchorRef: { current: null }, onPickModel, onOpenChange,
      modelInventory: { loading: false, provenance: "unavailable", refresh, ...inventory },
    }));
  });
  return { onPickModel, onOpenChange, refresh };
}

test.each(["codex", "claude", "copilot", "grok", "hermes", "opencode"])(
  "%s reports discovery failure with an immediate retry that preserves selection and menu", async (runtime) => {
    const callbacks = await render(runtime);
    expect(text()).toContain(`Couldn’t load ${runtime} models`);
    const retry = renderer.root.findAllByType("button").find(button => button.props.children === "Retry model discovery");
    expect(retry).toBeDefined();
    await act(async () => retry.props.onClick());
    expect(callbacks.refresh).toHaveBeenCalledOnce();
    expect(callbacks.onPickModel).not.toHaveBeenCalled();
    expect(callbacks.onOpenChange).not.toHaveBeenCalled();
    expect(text()).toContain("selected-model");
  },
);
test("loading is distinct from failure and cannot queue another retry", async () => {
  await render("codex", { loading: true });
  expect(text()).toContain("Loading codex models");
  expect(text()).not.toContain("Couldn’t load");
  expect(renderer.root.findAllByType("button").find(button => button.props.children === "Refreshing models…").props.disabled).toBe(true);
});
test("runtime-managed inventories explain ownership without promising discovery", async () => {
  await render("openclaw", { provenance: "runtime-managed", discoveryIssue: "runtime-managed" });
  expect(text()).toContain("openclaw manages its own models");
  expect(text()).not.toContain("Retry model discovery");
});

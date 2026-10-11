// @ts-expect-error -- This existing test dependency does not ship declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FamiliarSettingsSection } from "./familiar-tab-settings";
import { useUndoDelete } from "@/lib/use-undo-delete";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

const remove = vi.fn(async () => {});
function LifecycleProbe() {
  const { scheduleDelete, undo, pending } = useUndoDelete<string>();
  return <>
    <button data-action="remove" onClick={() => scheduleDelete("nova", "Nova", remove)}>Remove</button>
    {pending ? <button data-action="undo" onClick={undo}>Undo</button> : null}
  </>;
}
vi.mock("next/dynamic", () => ({ default: (loader: () => unknown) => loader.toString().includes("familiar-studio-identity-tab") ? LifecycleProbe : () => null }));
vi.mock("@/lib/use-surface-history", () => ({ useSurfaceHistory: ({ initial }: { initial: string }) => {
  const [value, show] = useState(initial);
  return { value, show, select: show };
} }));
vi.mock("@/components/ui/tabs", () => ({ Tabs: ({ onChange }: { onChange: (id: string) => void }) => <>
  <button data-tab="identity" onClick={() => onChange("identity")}>Identity</button>
  <button data-tab="chat" onClick={() => onChange("chat")}>Chat</button>
</> }));
vi.mock("@/components/ui/skeleton", () => ({ SkeletonRows: () => null }));
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers(); remove.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { act(() => tree?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
function renderSettings(scrollWithPanel = false) {
  return <FamiliarSettingsSection familiar={{ id: "nova", display_name: "Nova" } as ResolvedFamiliar} familiars={[]} allFamiliars={[]} scrollWithPanel={scrollWithPanel} />;
}
function setup() {
  act(() => { tree = create(renderSettings()); });
  act(() => tree.root.findByProps({ "data-action": "remove" }).props.onClick());
}
function tab(id: string) { act(() => tree.root.findByProps({ "data-tab": id }).props.onClick()); }

test("section navigation does not prematurely commit a pending removal and Undo remains effective", async () => {
  setup(); tab("chat"); tab("identity"); tab("chat"); tab("identity");
  expect(remove).not.toHaveBeenCalled();
  act(() => tree.root.findByProps({ "data-action": "undo" }).props.onClick());
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(remove).not.toHaveBeenCalled();
});

test("a pending removal commits once at its normal deadline while Identity is hidden", async () => {
  setup(); tab("chat");
  expect(remove).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(remove).toHaveBeenCalledTimes(1);
  tab("identity"); tab("chat");
  expect(remove).toHaveBeenCalledTimes(1);
});


test("keyboard viewport changes retain a pending removal and its Undo", async () => {
  setup();
  act(() => tree.update(renderSettings(true)));
  expect(remove).not.toHaveBeenCalled();
  act(() => tree.update(renderSettings(false)));
  expect(remove).not.toHaveBeenCalled();
  act(() => tree.root.findByProps({ "data-action": "undo" }).props.onClick());
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(remove).not.toHaveBeenCalled();
});

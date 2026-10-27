// @ts-nocheck -- react-test-renderer has no bundled types.
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { MarketplaceConfigure } from "./marketplace-configure";
import { Modal } from "@/components/ui/modal";

vi.mock("@/components/ui/modal", () => ({ Modal: ({ children, footerActions }) => <div>{children}{footerActions}</div> }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: () => {} }) }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

test("concurrent configuration saves keep dismissal gated until every write settles, preserving a failed draft", async () => {
  const fields = ["Region", "Bucket"].map(title => ({ key: title.toLowerCase(), title, env: title.toUpperCase(), sensitive: false, validatable: false, satisfied: false, default: null }));
  const writes = [];
  vi.stubGlobal("fetch", vi.fn((url, init) => {
    if (init?.method === "POST") return new Promise((resolve, reject) => writes.push({ resolve, reject }));
    return Promise.resolve({ json: async () => ({ ok: true, fields }) });
  }));
  await act(async () => { renderer = create(<MarketplaceConfigure pluginId="fixture" displayName="Fixture" open onClose={() => {}} onChanged={() => {}} />); });
  act(() => {
    renderer.root.findByProps({ "aria-label": "Region value" }).props.onChange({ target: { value: "west" } });
    renderer.root.findByProps({ "aria-label": "Bucket value" }).props.onChange({ target: { value: "draft-bucket" } });
  });
  const saves = renderer.root.findAllByType("button").filter(button => button.children.includes("Save"));
  act(() => { saves[0].props.onClick(); saves[1].props.onClick(); });
  expect(writes).toHaveLength(2);
  expect(renderer.root.findByType(Modal).props.busy).toBe(true);
  expect(renderer.root.findAllByType("button").find(button => button.children.includes("Done")).props.disabled).toBe(true);
  await act(async () => { writes[0].resolve({ json: async () => ({ ok: true }) }); });
  expect(renderer.root.findByType(Modal).props.busy).toBe(true);
  await act(async () => { writes[1].reject(new Error("Could not save bucket")); });
  expect(renderer.root.findByType(Modal).props.busy).toBe(false);
  expect(renderer.root.findByProps({ "aria-label": "Bucket value" }).props.value).toBe("draft-bucket");
  expect(renderer.root.findByProps({ role: "alert" }).children).toContain("Could not save bucket");
});

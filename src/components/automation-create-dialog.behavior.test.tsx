// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AutomationCreateDialog, type AutomationCreateInput } from "./automation-create-dialog";
import { StandardSelect } from "./ui/select";
import { CwdPickerField } from "./cwd-picker-field";

// Keep the real shared Modal while rendering its portal in the test tree.
vi.mock("react-dom", () => ({ createPortal: (children: unknown) => children }));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { body: {}, activeElement: null });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) })));
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
const text = (node: unknown): string => typeof node === "string" ? node : ((node as { children?: unknown[] } | null)?.children ?? []).map(text).join("");
const createButton = () => renderer!.root.findAll((node: { type: unknown }) => node.type === "button")
  .find((node: unknown) => /^Create|^Creating/.test(text(node)));

test("creation requires one familiar, rejects multiple directories and submits only supported settings paused", async () => {
  const submitted: AutomationCreateInput[] = [];
  const props = { resolvedFamiliars: [{ id: "alba", display_name: "Alba", role: "Helper", color: "var(--accent-presence)", glyph: { kind: "icon" as const, name: "ph:cat-fill" }, archived: false }],
    onClose() {}, onCreate(input: AutomationCreateInput) { submitted.push(input); } };
  await act(async () => { renderer = create(<AutomationCreateDialog {...props} />); });
  await act(async () => renderer!.root.findByProps({ placeholder: "Nightly code review" }).props.onChange({ target: { value: "Daily" } }));
  expect(createButton().props.disabled).toBe(true);
  await act(async () => renderer!.root.findByType(StandardSelect).props.onChange("alba"));
  expect(createButton().props.disabled).toBe(false);
  await act(async () => renderer!.root.findByType(CwdPickerField).props.onChange("/one\n/two"));
  expect(createButton().props.disabled).toBe(true);
  await act(async () => renderer!.root.findByType(CwdPickerField).props.onChange("/one"));
  await act(async () => createButton().props.onClick());
  expect(submitted).toHaveLength(1);
  expect(submitted[0].familiars).toEqual(["alba"]);
  expect(submitted[0].cwds).toEqual(["/one"]);
  expect(submitted[0].start).toBe("paused");
  expect(submitted[0]).not.toHaveProperty("reasoning_effort");
  expect(submitted[0]).not.toHaveProperty("execution_environment");
  expect(submitted[0]).not.toHaveProperty("skill_path");
  await act(async () => renderer!.update(<AutomationCreateDialog {...props} busy error="Creation is unconfirmed. Retry the original request." />));
  expect(createButton().props.disabled).toBe(true);
  expect(text(renderer!.root.findByProps({ role: "alert" }))).toMatch(/unconfirmed/);
});

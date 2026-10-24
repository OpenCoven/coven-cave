// The detail panel never wipes an unsaved edit when Coven's copy changes
// underneath it, saves against the definition the form was loaded from, and
// shows the revision review when the owner hands one in (#5217).
// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CodexAutomation, CodexAutomationPatch } from "@/lib/codex-automations-types";
import type { AutomationLifecycleView } from "@/lib/automations/lifecycle";
import { reviewRevisionRebase } from "@/lib/automations/revision-rebase";
import { CodexDetailPanel } from "./cron-detail-panel";

const base: CodexAutomation = {
  id: "nightly", name: "Nightly digest", kind: "cron", status: "ACTIVE", rrule: "RRULE:FREQ=DAILY;BYHOUR=9",
  model: null, reasoningEffort: null, executionEnvironment: null, cwds: [], tags: [], familiars: [],
  prompt: "Summarize the day.", skillPath: null, scheduleHuman: "Daily at 09:00",
};
const lifecycle: AutomationLifecycleView = { state: "active", revision: 4, timezone: "UTC", freshness: "live", readAt: new Date().toISOString() };

let renderer: ReactTestRenderer | undefined;
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  consoleError = vi.spyOn(console, "error");
  // Every background read (health, occurrences, feed, skills) answers unavailable.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ kind: "unavailable", ok: false }) })));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  // A duplicate key or an update outside act() is a rendering bug, not noise.
  const reactWarnings = consoleError.mock.calls.filter(([message]: unknown[]) => typeof message === "string" && /same key|not wrapped in act/.test(message));
  consoleError.mockRestore();
  vi.unstubAllGlobals();
  expect(reactWarnings).toEqual([]);
});

type Props = Parameters<typeof CodexDetailPanel>[0];
function props(extra: Partial<Props> = {}): Props & { saves: { auto: CodexAutomation; patch: CodexAutomationPatch }[] } {
  const saves: { auto: CodexAutomation; patch: CodexAutomationPatch }[] = [];
  return {
    saves,
    auto: base, lifecycle, busy: false, expanded: false, runs: [],
    onToggleExpanded() {}, onClose() {}, onToggle() {}, onDelete() {}, onRun() {},
    onSave: (auto, patch) => { saves.push({ auto, patch }); },
    ...extra,
  };
}

const text = (node: unknown): string =>
  typeof node === "string" ? node : ((node as { children?: unknown[] } | null)?.children ?? []).map(text).join("");
const nameInput = () => renderer!.root.find((node: { type: unknown; props: { id?: string } }) => node.type === "input" && node.props.id === "cron-name-nightly");
const button = (pattern: RegExp) => renderer!.root.findAll((node: { type: unknown }) => node.type === "button").find((node: unknown) => pattern.test(text(node)));

async function mount(value: Props) {
  await act(async () => { renderer = create(<CodexDetailPanel {...value} />); });
}
async function update(value: Props) {
  await act(async () => renderer!.update(<CodexDetailPanel {...value} />));
}

test("a background update keeps the unsaved edit, says so, and Save names the original base", async () => {
  const value = props();
  await mount(value);
  await act(async () => nameInput().props.onChange({ target: { value: "Morning digest" } }));
  await update({ ...value, auto: { ...base, prompt: "Summarize the week." } });
  expect(nameInput().props.value).toBe("Morning digest");
  expect(text(renderer!.toJSON())).toMatch(/Coven's copy of this cron changed while you were editing\. Your edits are kept/);
  await act(async () => button(/Save changes/)!.props.onClick());
  expect(value.saves).toHaveLength(1);
  expect(value.saves[0].auto).toBe(base);
  expect(value.saves[0].patch.name).toBe("Morning digest");
  expect(value.saves[0].patch.prompt).toBe(base.prompt);
});

test("without an edit, a newer copy loads straight into the form", async () => {
  const value = props();
  await mount(value);
  await update({ ...value, auto: { ...base, name: "Renamed in Coven" } });
  expect(nameInput().props.value).toBe("Renamed in Coven");
  expect(text(renderer!.toJSON())).not.toMatch(/changed while you were editing/);
});

test("the owner's reset key loads the definition over the edit, as after a save or Use Coven's version", async () => {
  const value = props({ formResetKey: 0 });
  await mount(value);
  await act(async () => nameInput().props.onChange({ target: { value: "Morning digest" } }));
  await update({ ...value, auto: { ...base, name: "Evening digest" }, formResetKey: 1 });
  expect(nameInput().props.value).toBe("Evening digest");
  expect(button(/Save changes/)!.props.disabled).toBe(true);
});

test("a refused save shows the review in the panel and routes its choices to the owner", async () => {
  const chosen: { patch: CodexAutomationPatch; revision: number }[] = [];
  const rebase = reviewRevisionRebase(base, { name: "Morning digest" }, { ...base, prompt: "Changed." }, 5);
  await mount(props({ conflict: rebase, onConflictSaveMine: (patch, revision) => { chosen.push({ patch, revision }); } }));
  expect(text(renderer!.toJSON())).toMatch(/Coven has a newer revision/);
  await act(async () => button(/Save my changes on revision 5/)!.props.onClick());
  expect(chosen).toEqual([{ patch: { name: "Morning digest" }, revision: 5 }]);
});

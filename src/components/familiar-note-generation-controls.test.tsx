// @ts-expect-error -- react-test-renderer has no declarations in this repository.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FamiliarNoteGenerationControls } from "./familiar-note-generation-controls";
const mocks = vi.hoisted(() => ({ load: vi.fn(), run: vi.fn(), announce: vi.fn() }));
vi.mock("@/lib/daily-note-generation", () => ({ loadNoteActivity: mocks.load, runDailyNoteBatch: mocks.run }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: mocks.announce }) }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
let root: ReactTestRenderer;
const onComplete = vi.fn();
const onBusyChange = vi.fn();
const activity = { date: "2026-10-01", digest: "Work", context: "Evidence", exists: false };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ days: [activity] });
  mocks.run.mockResolvedValue([{ date: activity.date, status: "generated" }]);
});
afterEach(() => { act(() => root?.unmount()); vi.unstubAllGlobals(); });
async function render(extra = {}) {
  await act(async () => { root = create(<FamiliarNoteGenerationControls familiarId="sage" date="2026-10-01" exists={false} disabled={false} onComplete={onComplete} onBusyChange={onBusyChange} {...extra} />); });
}
function button(label: string) {
  return root.root.findAllByType("button").find((node: { props: { children: unknown[] } }) => node.props.children.flat().includes(label))!;
}
test("inactive and existing days cannot generate; activity errors can retry", async () => {
  mocks.load.mockResolvedValue({ days: [] });
  await render();
  expect(button("Generate").props.disabled).toBe(true);
  await act(async () => { root.update(<FamiliarNoteGenerationControls familiarId="sage" date="2026-10-02" exists disabled={false} onComplete={onComplete} onBusyChange={onBusyChange} />); });
  expect(button("Generate").props.disabled).toBe(true);
  mocks.load.mockRejectedValueOnce(new Error("Unavailable"));
  await act(async () => { root.update(<FamiliarNoteGenerationControls familiarId="sage" date="2026-10-03" exists={false} disabled={false} onComplete={onComplete} onBusyChange={onBusyChange} />); });
  expect(button("Retry activity")).toBeDefined();
  mocks.load.mockResolvedValue({ days: [activity] });
  await act(async () => { button("Retry activity").props.onClick(); });
  expect(button("Generate").props.disabled).toBe(false);
});
test("backfill submits only missing active days and announces completion", async () => {
  await render();
  mocks.load.mockResolvedValue({ days: [activity, { ...activity, date: "2026-10-02", exists: true }] });
  await act(async () => { button("Backfill active days").props.onClick(); });
  expect(mocks.run.mock.calls[0][0].dates).toEqual(["2026-10-01"]);
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(onComplete).toHaveBeenCalledOnce();
  expect(mocks.announce).toHaveBeenCalledWith("1 note generated.");
});
test("leaving the familiar cancels a batch and prevents stale completion callbacks", async () => {
  let finish!: (result: unknown[]) => void;
  mocks.run.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render();
  await act(async () => { button("Generate").props.onClick(); });
  const signal = mocks.run.mock.calls[0][0].signal;
  expect(signal.aborted).toBe(false);
  act(() => root.unmount());
  expect(signal.aborted).toBe(true);
  await act(async () => { finish([]); });
  expect(onComplete).not.toHaveBeenCalled();
});

// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePausablePoll } from "./use-pausable-poll";

const foreground = vi.hoisted(() => ({ refresh: () => {} }));
vi.mock("@/lib/use-refresh-on-focus", async (original) => ({
  ...await original<typeof import("./use-refresh-on-focus")>(),
  useRefreshOnFocus: (refresh: () => void) => { foreground.refresh = refresh; },
}));

let renderer: ReactTestRenderer;
function Probe({ refresh, serialize }: { refresh: () => void | Promise<void>; serialize?: boolean }) {
  usePausablePoll(refresh, 1000, { serialize });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { hidden: false });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("polls and foreground refresh share one in-flight request", async () => {
  let complete!: () => void;
  const refresh = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  await act(async () => { renderer = create(<Probe refresh={refresh} serialize />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { foreground.refresh(); await vi.advanceTimersByTimeAsync(3000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => complete());
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () => complete());
});

test("a rejected refresh releases the next poll and hidden focus stays quiet", async () => {
  const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  await act(async () => { renderer = create(<Probe refresh={refresh} serialize />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(refresh).toHaveBeenCalledTimes(2);
  vi.stubGlobal("document", { hidden: true });
  await act(async () => { foreground.refresh(); await vi.advanceTimersByTimeAsync(1000); });
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("existing unbounded callbacks keep polling unless serialization is explicitly enabled", async () => {
  const refresh = vi.fn(() => new Promise<void>(() => {}));
  await act(async () => { renderer = create(<Probe refresh={refresh} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); foreground.refresh(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(refresh).toHaveBeenCalledTimes(4);
});

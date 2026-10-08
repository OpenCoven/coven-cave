// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePausablePoll } from "./use-pausable-poll";

const foreground = vi.hoisted(() => ({ refresh: () => {}, enabled: true }));
vi.mock("@/lib/use-refresh-on-focus", async (original) => ({
  ...await original<typeof import("./use-refresh-on-focus")>(),
  useRefreshOnFocus: (refresh: () => void, opts?: { enabled?: boolean }) => {
    foreground.refresh = refresh;
    foreground.enabled = opts?.enabled ?? true;
  },
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

function GatedProbe(props: { refresh: () => void; intervalEnabled?: boolean; refreshOnFocusEnabled?: boolean; enabled?: boolean }) {
  usePausablePoll(props.refresh, 1000, {
    enabled: props.enabled,
    intervalEnabled: props.intervalEnabled,
    refreshOnFocusEnabled: props.refreshOnFocusEnabled,
  });
  return null;
}

test("intervalEnabled: false pauses only the recurring poll (#5858)", async () => {
  const refresh = vi.fn();
  await act(async () => { renderer = create(<GatedProbe refresh={refresh} intervalEnabled={false} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(refresh).toHaveBeenCalledTimes(0);
  expect(foreground.enabled).toBe(true);
  await act(async () => { foreground.refresh(); });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(<GatedProbe refresh={refresh} intervalEnabled />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("refreshOnFocusEnabled: false disables only the on-return refresh (#5858)", async () => {
  const refresh = vi.fn();
  await act(async () => { renderer = create(<GatedProbe refresh={refresh} refreshOnFocusEnabled={false} />); });
  expect(foreground.enabled).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("enabled: false still overrides both gates, and callers without them are unchanged", async () => {
  const refresh = vi.fn();
  await act(async () => { renderer = create(<GatedProbe refresh={refresh} enabled={false} intervalEnabled refreshOnFocusEnabled />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(refresh).toHaveBeenCalledTimes(0);
  expect(foreground.enabled).toBe(false);
  await act(async () => renderer.update(<GatedProbe refresh={refresh} />));
  expect(foreground.enabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refresh).toHaveBeenCalledTimes(1);
});

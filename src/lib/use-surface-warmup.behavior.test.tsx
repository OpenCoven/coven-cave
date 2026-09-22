// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useSurfaceWarmup } from "./use-surface-warmup";

const warm = vi.hoisted(() => ({ run: vi.fn(), abort: vi.fn() }));
vi.mock("@/lib/surface-warmup-registry", () => ({ warmSurface: warm.run }));
vi.mock("@/lib/surface-warm-cache", () => ({ abortWarm: warm.abort, invalidateIfDefined: vi.fn() }));
vi.mock("@/lib/perf/marks", () => ({ markStart: vi.fn(), markEnd: vi.fn() }));
let renderer: ReactTestRenderer;
let connection: EventTarget & { saveData: boolean; effectiveType: string };
function Probe() { useSurfaceWarmup(); return null; }

beforeEach(() => {
  vi.useFakeTimers();
  warm.run.mockReset().mockResolvedValue({ backpressured: false });
  warm.abort.mockReset();
  connection = Object.assign(new EventTarget(), { saveData: false, effectiveType: "4g" });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { onLine: true, connection });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 16),
    cancelAnimationFrame: clearTimeout,
    setTimeout, clearTimeout,
  }));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each(["save-data", "2g", "slow-2g"])("defers speculative work on %s and resumes when unconstrained", async mode => {
  connection.saveData = mode === "save-data";
  connection.effectiveType = mode === "save-data" ? "4g" : mode;
  await act(async () => { renderer = create(<Probe />); await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(warm.run).not.toHaveBeenCalled();
  connection.saveData = false;
  connection.effectiveType = "4g";
  await act(async () => { connection.dispatchEvent(new Event("change")); await vi.advanceTimersByTimeAsync(2000); });
  expect(warm.run).toHaveBeenCalled();
});

test("switching to data saver aborts active warming and unmount removes its listener", async () => {
  warm.run.mockReturnValue(new Promise(() => {}));
  await act(async () => { renderer = create(<Probe />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(warm.run).toHaveBeenCalledTimes(1);
  connection.saveData = true;
  connection.dispatchEvent(new Event("change"));
  expect(warm.abort).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
  warm.abort.mockClear();
  connection.dispatchEvent(new Event("change"));
  expect(warm.abort).not.toHaveBeenCalled();
});

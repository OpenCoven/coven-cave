// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useSurfaceCacheInvalidation } from "./use-surface-cache-invalidation";

const cache = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("@/lib/surface-warm-cache", () => ({ invalidateIfDefined: cache.invalidate }));
let renderer: ReactTestRenderer;
function Probe() { useSurfaceCacheInvalidation(); return null; }

beforeEach(() => {
  cache.invalidate.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("mount and idle time do no speculative work; writes invalidate and cleanup removes listeners", async () => {
  await act(async () => { renderer = create(<Probe />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(cache.invalidate).not.toHaveBeenCalled();
  const events = ["cave:board:reload", "cave:schedules:reload", "cave:familiars-refresh"];
  for (const event of events) window.dispatchEvent(new Event(event));
  expect(cache.invalidate.mock.calls).toEqual([
    ["board:cards", "tasks:queue"],
    ["schedules:inbox", "schedules:automations"],
    ["github:familiars"],
  ]);
  await act(async () => renderer.unmount());
  cache.invalidate.mockClear();
  for (const event of events) window.dispatchEvent(new Event(event));
  expect(cache.invalidate).not.toHaveBeenCalled();
});

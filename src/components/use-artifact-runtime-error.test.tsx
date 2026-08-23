// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  ARTIFACT_NAVIGATION_WARNING,
  ARTIFACT_NAVIGATION_WARNING_DURATION_MS,
  useArtifactRuntimeError,
} from "./use-artifact-runtime-error";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let setRuntimeError;
let showNavigationWarning;

function Harness() {
  const runtime = useArtifactRuntimeError();
  setRuntimeError = runtime.setRuntimeError;
  showNavigationWarning = runtime.showNavigationWarning;
  return runtime.runtimeError ? <span>{runtime.runtimeError}</span> : null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("navigation warning appears immediately, lasts three seconds, and restarts when repeated", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<Harness />);
  });

  await act(async () => showNavigationWarning());
  expect(renderer.root.findByType("span").children).toEqual([ARTIFACT_NAVIGATION_WARNING]);

  await act(async () => vi.advanceTimersByTime(2_000));
  await act(async () => showNavigationWarning());
  await act(async () => vi.advanceTimersByTime(ARTIFACT_NAVIGATION_WARNING_DURATION_MS - 1));
  expect(renderer.root.findByType("span").children).toEqual([ARTIFACT_NAVIGATION_WARNING]);

  await act(async () => vi.advanceTimersByTime(1));
  expect(renderer.toJSON()).toBeNull();
  await act(async () => renderer.unmount());
});

test("replacement, explicit clearing, and unmount cancel the navigation timer", async () => {
  let renderer;
  await act(async () => {
    renderer = create(<Harness />);
  });

  await act(async () => showNavigationWarning());
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => setRuntimeError("Sandbox failed."));
  expect(vi.getTimerCount()).toBe(0);

  await act(async () => vi.advanceTimersByTime(ARTIFACT_NAVIGATION_WARNING_DURATION_MS));
  expect(renderer.root.findByType("span").children).toEqual(["Sandbox failed."]);

  await act(async () => setRuntimeError(null));
  expect(renderer.toJSON()).toBeNull();

  await act(async () => showNavigationWarning());
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => renderer.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

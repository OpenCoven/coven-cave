// @ts-expect-error -- This existing test dependency does not ship declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CodeRailReopen } from "./code-rail-reopen";
import { useCodeRail } from "@/lib/use-code-rail";

const { announce } = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce }) }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));

let root: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => "false", setItem: vi.fn() },
    matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  announce.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(nonce: number, count = 2, onOpen = vi.fn()) {
  act(() => {
    const component = <CodeRailReopen changeNonce={nonce} changeCount={count} onOpen={onOpen} />;
    if (root) root.update(component);
    else root = create(component);
  });
}
function cue() {
  return root!.root.findByProps({ className: "workspace-rail-reopen__tab" });
}

test("mount and unchanged summaries are quiet; a new summary announces and settles without animation events", () => {
  render(4);
  expect(cue().props["data-notifying"]).toBeUndefined();
  expect(announce).not.toHaveBeenCalled();
  render(5);
  expect(cue().props["data-notifying"]).toBe("true");
  expect(announce).toHaveBeenCalledTimes(1);
  render(5);
  expect(announce).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(1600));
  expect(cue().props["data-notifying"]).toBeUndefined();
  render(5);
  expect(announce).toHaveBeenCalledTimes(1);
});

test("a later update restarts a bounded cue; finishing it never opens the rail", () => {
  const open = vi.fn();
  render(0, 1, open);
  render(1, 1, open);
  act(() => vi.advanceTimersByTime(1200));
  render(2, 1, open);
  act(() => vi.advanceTimersByTime(800));
  expect(cue().props["data-notifying"]).toBe("true");
  act(() => cue().props.onAnimationEnd());
  expect(cue().props["data-notifying"]).toBeUndefined();
  expect(open).not.toHaveBeenCalled();
  act(() => root!.root.findByType("button").props.onClick());
  expect(open).toHaveBeenCalledTimes(1);
});

test("opening the collapsed rail to Changes preserves the explicit tab selection", () => {
  function Harness() {
    const rail = useCodeRail({ projectRoot: "/repo", changeCount: 2, terminalActive: false, autoRevealChanges: false });
    return <button data-open={rail.open} data-tab={rail.activeTab} onClick={() => {
      rail.reopen();
      rail.setActiveTab("changes");
    }} />;
  }
  act(() => { root = create(<Harness />); });
  expect(root!.root.findByType("button").props["data-open"]).toBe(false);
  act(() => root!.root.findByType("button").props.onClick());
  expect(root!.root.findByType("button").props["data-open"]).toBe(true);
  expect(root!.root.findByType("button").props["data-tab"]).toBe("changes");
});

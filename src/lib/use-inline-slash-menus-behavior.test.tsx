// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// use-surface-history.test.tsx.
//
// cave-y7rg0: a slash command typed AFTER prose must complete on Enter, never
// run. inlineSlashInvocation deliberately opens the menu mid-draft, and
// running an intent from there throws the draft away — /clear also calls
// setTurns([]) and wipes the whole transcript. A source pin can prove the
// guard's shape but not that Enter takes the harmless branch, so this drives
// the real keydown path.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useInlineSlashMenus } from "./use-inline-slash-menus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  // The hook fetches skills and prompts on mount; neither matters here.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
  // This repo's vitest runs in the node environment (no jsdom/happy-dom), and
  // the hook's only DOM touchpoint is the `cave:prompts-refresh` listener — so
  // stub that rather than pull in a DOM implementation for two calls.
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

/** Mount the hook over a fixed draft and expose its return to the test. */
function mount(text: string, caret = text.length) {
  const calls = { run: [] as string[], completed: [] as { text: string; caret: number }[] };
  const latest = { current: null as ReturnType<typeof useInlineSlashMenus> | null };
  function Probe() {
    latest.current = useInlineSlashMenus({
      text,
      setText: () => {},
      caret,
      onCompleteText: (nextText, nextCaret) => calls.completed.push({ text: nextText, caret: nextCaret }),
      modelHarness: "claude",
      modelOptionsOverride: [],
      onPickModel: () => {},
      onPickSkill: () => {},
      onInsertPrompt: () => {},
      onRunCommand: (cmd) => calls.run.push(cmd.name),
    });
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return { calls, latest };
}

function pressEnter(latest: { current: { handleKeyDown: (e: unknown) => boolean } | null }) {
  let consumed = false;
  act(() => {
    consumed = latest.current.handleKeyDown({
      key: "Enter",
      shiftKey: false,
      preventDefault: () => {},
    });
  });
  return consumed;
}

test("a slash command typed after prose completes on Enter instead of running", () => {
  const { calls, latest } = mount("please summarise this /clear");

  expect(pressEnter(latest)).toBe(true);

  // The destructive intent must never fire from a mid-draft slash.
  expect(calls.run).toEqual([]);
  // …and the prose the user typed has to survive the completion.
  expect(calls.completed).toHaveLength(1);
  expect(calls.completed[0].text).toBe("please summarise this /clear");
});

test("the same command still runs when it owns the whole draft", () => {
  const { calls, latest } = mount("/clear");

  expect(pressEnter(latest)).toBe(true);

  expect(calls.run).toEqual(["/clear"]);
  expect(calls.completed).toEqual([]);
});

test("an argument-taking command mid-draft also completes rather than running", () => {
  const { calls, latest } = mount("switch it for me /model");

  expect(pressEnter(latest)).toBe(true);

  expect(calls.run).toEqual([]);
  expect(calls.completed).toHaveLength(1);
  expect(calls.completed[0].text).toBe("switch it for me /model ");
});

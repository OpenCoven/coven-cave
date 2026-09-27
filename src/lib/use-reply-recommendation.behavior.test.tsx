// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RECOMMEND_SETTLE_DELAY_MS, useReplyRecommendation } from "./use-reply-recommendation";

// #5625: the automatic suggestion is a streaming model run; it starts only once
// a settled reply has stayed in view, never while a chat is being skimmed.
const stream = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/familiar-stream", () => ({
  streamFamiliarText: vi.fn(() => {
    stream.calls += 1;
    return new Promise(() => {});
  }),
}));

type Turn = { role: "user" | "assistant"; text: string };
// Distinct reply lengths: the hook anchors on (index, reply length).
const thread = (label: string): Turn[] => [
  { role: "user", text: `question ${label}` },
  { role: "assistant", text: `answer ${label.repeat(label.charCodeAt(0) - 96)}` },
];

let renderer: ReactTestRenderer;
function Probe({ messages, draft = "", enabled = true }: { messages: Turn[]; draft?: string; enabled?: boolean }) {
  useReplyRecommendation({ messages, familiarId: "cody", familiarName: "Cody", draft, enabled });
  return null;
}

beforeEach(() => {
  stream.calls = 0;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("a chat that stays open gets its suggestion after the settle delay", async () => {
  await act(async () => { renderer = create(<Probe messages={thread("a")} />); });
  expect(stream.calls).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(RECOMMEND_SETTLE_DELAY_MS - 1); });
  expect(stream.calls).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(stream.calls).toBe(1);
});

test("skimming through chats starts no model run", async () => {
  await act(async () => { renderer = create(<Probe messages={thread("a")} />); });
  for (const label of ["b", "c", "d"]) {
    await act(async () => { await vi.advanceTimersByTimeAsync(RECOMMEND_SETTLE_DELAY_MS / 3); });
    await act(async () => { renderer.update(<Probe messages={thread(label)} />); });
  }
  expect(stream.calls).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(RECOMMEND_SETTLE_DELAY_MS); });
  expect(stream.calls).toBe(1);
});

test("typing or going inactive during the delay cancels the pending start", async () => {
  await act(async () => { renderer = create(<Probe messages={thread("a")} />); });
  await act(async () => { renderer.update(<Probe messages={thread("a")} draft="my own reply" />); });
  await act(async () => { renderer.update(<Probe messages={thread("b")} enabled={false} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(RECOMMEND_SETTLE_DELAY_MS * 2); });
  expect(stream.calls).toBe(0);
});

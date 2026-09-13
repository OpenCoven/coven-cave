// @ts-expect-error The repository's renderer test dependency has no declaration package.
import { act, create } from "react-test-renderer";
import type { ReactElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { useChatContinuitySource } from "./use-chat-continuity-source";
import { continuitySourceId } from "./chat-continuity-preferences";

let renderer: { update(element: ReactElement): void; unmount(): void } | undefined;
let current: ReturnType<typeof useChatContinuitySource>;
function Probe({ enabled }: { enabled: boolean }) {
  current = useChatContinuitySource(enabled);
  return null;
}
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { location: { origin: "http://cave.test" } });
}
test("producer health, not origin alone, scopes saved locations", async () => {
  setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { instanceId: "instance-a" } })));
  await act(async () => { renderer = create(<Probe enabled />); });
  expect(current).toEqual({ status: "ready", id: continuitySourceId("instance-a", "http://cave.test") });
});
test("health failure leaves restoration unavailable, never origin-scoped", async () => {
  setup();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: {} })));
  await act(async () => { renderer = create(<Probe enabled />); });
  expect(current).toEqual({ status: "unavailable", id: null });
});
test("late identity completion after disable cannot repopulate the source", async () => {
  setup();
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
  await act(async () => { renderer = create(<Probe enabled />); });
  await act(async () => renderer!.update(<Probe enabled={false} />));
  await act(async () => resolve(Response.json({ data: { instanceId: "old-instance" } })));
  expect(current).toEqual({ status: "unavailable", id: null });
});

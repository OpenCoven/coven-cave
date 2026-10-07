// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CaveEventInvalidation, CaveEventPlaneClient, CaveEventPlaneState } from "./cave-event-plane-client";
import type { CaveEventRolloutMode, CaveEventTopic } from "./cave-event-plane-protocol";
import { useCaveEventPlane, type CaveEventPlaneTopicHealth } from "./use-cave-event-plane";

function createFakeClient(initial: { ready?: CaveEventTopic[]; mode?: CaveEventRolloutMode; state?: CaveEventPlaneState } = {}) {
  const subs = new Map<CaveEventTopic, Set<(event: CaveEventInvalidation) => void>>();
  const changes = new Set<() => void>();
  let ready = new Set(initial.ready ?? []);
  let state: CaveEventPlaneState = initial.state ?? "ready";
  let subscribeCalls = 0;
  const client: CaveEventPlaneClient = {
    subscribe(topic, listener) {
      subscribeCalls += 1;
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic)!.add(listener);
      return () => subs.get(topic)!.delete(listener);
    },
    topicReady: (topic) => state === "ready" && ready.has(topic),
    state: () => state,
    rolloutMode: () => initial.mode ?? "primary",
    onChange(listener) {
      changes.add(listener);
      return () => changes.delete(listener);
    },
    diagnostics: () => { throw new Error("unused"); },
    refreshCapabilities: async () => {},
    dispose: () => {},
  };
  return {
    client,
    subscriptions: () => [...subs].filter(([, set]) => set.size > 0).map(([topic]) => topic),
    subscribeCalls: () => subscribeCalls,
    emit(topic: CaveEventTopic, event: CaveEventInvalidation) {
      for (const listener of subs.get(topic) ?? []) listener(event);
    },
    set(next: { ready?: CaveEventTopic[]; state?: CaveEventPlaneState }) {
      if (next.ready) ready = new Set(next.ready);
      if (next.state) state = next.state;
      for (const listener of changes) listener();
    },
  };
}

let renderer: ReactTestRenderer | null = null;
let health: CaveEventPlaneTopicHealth | null = null;

function Probe(props: {
  client: CaveEventPlaneClient;
  topic: CaveEventTopic;
  onInvalidate: (event: CaveEventInvalidation) => void;
  enabled?: boolean;
}) {
  health = useCaveEventPlane(props.topic, props.onInvalidate, { client: props.client, enabled: props.enabled });
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  health = null;
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

test("subscribes on mount and releases on unmount", () => {
  const fake = createFakeClient();
  act(() => { renderer = create(<Probe client={fake.client} topic="board" onInvalidate={() => {}} />); });
  expect(fake.subscriptions()).toEqual(["board"]);
  act(() => renderer!.unmount());
  renderer = null;
  expect(fake.subscriptions()).toEqual([]);
});

test("returns topic health for polling gates and follows changes", () => {
  const fake = createFakeClient({ ready: ["sessions"] });
  act(() => { renderer = create(<Probe client={fake.client} topic="sessions" onInvalidate={() => {}} />); });
  expect(health).toEqual({ ready: true, rolloutMode: "primary", state: "ready" });
  act(() => fake.set({ state: "backing-off" }));
  expect(health).toEqual({ ready: false, rolloutMode: "primary", state: "backing-off" });
});

test("a new callback identity reaches the latest handler without resubscribing", () => {
  const fake = createFakeClient();
  const seen: string[] = [];
  act(() => { renderer = create(<Probe client={fake.client} topic="board" onInvalidate={() => seen.push("first")} />); });
  act(() => renderer!.update(<Probe client={fake.client} topic="board" onInvalidate={() => seen.push("second")} />));
  act(() => fake.emit("board", { topic: "board", version: 1 }));
  expect(seen).toEqual(["second"]);
  expect(fake.subscribeCalls()).toBe(1);
});

test("a disabled hook neither subscribes nor reports ready", () => {
  const fake = createFakeClient({ ready: ["board"] });
  act(() => { renderer = create(<Probe client={fake.client} topic="board" onInvalidate={() => {}} enabled={false} />); });
  expect(fake.subscriptions()).toEqual([]);
  expect(health?.ready).toBe(false);
});

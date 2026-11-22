import { createElement } from "react";
// @ts-expect-error -- This repository uses react-test-renderer without its declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { createQuickStartState } from "@/lib/first-use";
import { LiveRegionProvider } from "./ui/live-region";
import { FirstUseProvider, useFirstUse, type FirstUsePayload } from "./first-use-provider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
let context: ReturnType<typeof useFirstUse>;
const defaults = { projectId: "p", familiarIds: ["nova"], actingFamiliarId: "nova" };
function payload(revision: number): FirstUsePayload {
  return {
    state: { version: 1, revision, step: "complete", outcome: "plan", defaults, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T00:00:00.000Z" },
    resolution: { kind: "ready", context: defaults }, access: [], project: null,
  };
}
function Probe() { context = useFirstUse(); return null; }
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

test("an older eligibility response cannot roll back progress saved while that read was in flight", async () => {
  const requests: Array<{ options?: RequestInit; resolve: (response: Response) => void }> = [];
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", (_url: string, options?: RequestInit) => new Promise<Response>((resolve) => requests.push({ options, resolve })));
  await act(async () => { renderer = create(createElement(LiveRegionProvider, null, createElement(FirstUseProvider, null, createElement(Probe)))); });
  await act(async () => { requests.shift()!.resolve(Response.json({ ok: true, ...payload(8) })); });
  let save!: Promise<boolean>;
  let read!: ReturnType<typeof context.refresh>;
  await act(async () => { save = context.mutate({ kind: "context", defaults }); });
  const write = requests.shift()!;
  await act(async () => { read = context.refresh(); });
  const staleRead = requests.shift()!;
  await act(async () => { write.resolve(Response.json({ ok: true, ...payload(9) })); await save; });
  expect(context.payload?.state.revision).toBe(9);
  await act(async () => { staleRead.resolve(Response.json({ ok: true, ...payload(8) })); await read; });
  expect(context.payload?.state.revision).toBe(9);
});

test("a superseded validation read cannot return cached readiness as fresh admission evidence", async () => {
  const requests: Array<{ resolve: (response: Response) => void }> = [];
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => requests.push({ resolve })));
  await act(async () => { renderer = create(createElement(LiveRegionProvider, null, createElement(FirstUseProvider, null, createElement(Probe)))); });
  await act(async () => requests.shift()!.resolve(Response.json({ ok: true, ...payload(8) })));
  let validating!: ReturnType<typeof context.refresh>;
  let focusRefresh!: ReturnType<typeof context.refresh>;
  await act(async () => { validating = context.refresh(); });
  const validationRequest = requests.shift()!;
  await act(async () => { focusRefresh = context.refresh(); });
  const focusRequest = requests.shift()!;
  const repair = { ...payload(8), resolution: { kind: "repair", context: defaults, reason: "access", message: "A scope member lost access" } };
  let admissionEvidence: FirstUsePayload | null = null;
  await act(async () => { validationRequest.resolve(Response.json({ ok: true, ...repair })); admissionEvidence = await validating; });
  await act(async () => { focusRequest.resolve(Response.json({ ok: true, ...repair })); await focusRefresh; });
  expect(admissionEvidence).toBeNull();
  expect(context.payload?.resolution.kind).toBe("repair");
});

test("suppressing setup persists across visits and leaves execution gated", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } }));
  const methods: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, options?: RequestInit) => {
    methods.push(options?.method ?? "GET");
    return Response.json({ ok: true, ...payload(0), state: createQuickStartState() });
  });
  const mount = () => act(async () => {
    renderer = create(createElement(LiveRegionProvider, null, createElement(FirstUseProvider, null, createElement(Probe))));
  });
  await mount();
  expect(context.open).toBe(true);
  await act(async () => context.suppressGuide());
  expect(context.open).toBe(false);
  await act(async () => renderer.unmount());
  await mount();
  expect(context.open).toBe(false);
  expect(context.suppressed).toBe(true);
  await act(async () => context.openGuide());
  expect(context.open).toBe(true);
  await act(async () => context.closeGuide());
  await act(async () => { expect(context.ensureIntroduction()).toBe(false); });
  expect(context.payload?.state.step).toBe(createQuickStartState().step);
  expect(methods.every(method => method === "GET")).toBe(true);
});

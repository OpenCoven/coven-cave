import { createElement } from "react";
// @ts-expect-error -- This repository uses react-test-renderer without its declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
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

// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { JournalAutomationCard } from "./journal-automation-card";

const { confirm, announce } = vi.hoisted(() => ({ confirm: vi.fn(), announce: vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => confirm }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce }) }));
vi.mock("@/lib/use-pausable-poll", () => ({ usePausablePoll: () => undefined }));

let renderer: ReactTestRenderer | undefined;
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const paused = { id: "journal-astra", status: "PAUSED", hour: 8, minute: 0, revision: 2,
  reviewedSource: { revision: 2, routine: { id: "journal-astra", rrule: "FREQ=DAILY;BYHOUR=8", timezone: "UTC", runtime: "coven-code", prompt: "Reflect" } } };
const body = (routine: unknown = null) => ({ ok: true, available: true, routine, lastRun: null });
const toggle = async () => { await act(async () => renderer!.root.findByProps({ role: "switch" }).props.onClick()); };
const mount = async () => { await act(async () => { renderer = create(<JournalAutomationCard familiarId="astra" familiarName="Astra" />); }); };
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); confirm.mockReset(); announce.mockReset(); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

test("creation stays paused when the activation review is declined", async () => {
  confirm.mockResolvedValue(false);
  const fetcher = vi.fn(async (_url, options) => response(options?.method === "PUT" ? body(paused) : body()));
  vi.stubGlobal("fetch", fetcher);
  await mount();
  await toggle();
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0][0].body).toMatch(/revision 2.*UTC.*Reflect/);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  expect(renderer!.root.findByProps({ role: "switch" }).props["aria-checked"]).toBe(false);
});

test("activation submits only the explicitly reviewed revision", async () => {
  confirm.mockResolvedValue(true);
  const fetcher = vi.fn(async (_url, options) => response(options?.method === "PUT" ? body(paused)
    : options?.method === "POST" ? { kind: "committed" } : body()));
  vi.stubGlobal("fetch", fetcher);
  await mount();
  await toggle();
  const posts = fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body)).toEqual({ command: "activate", expectedRevision: 2, adoptionKey: "journal-activate:journal-astra:2" });
});

test("an uncertain journal save retries the exact original request", async () => {
  confirm.mockResolvedValue(false);
  let puts = 0;
  const fetcher = vi.fn(async (_url, options) => {
    if (options?.method !== "PUT") return response(body());
    if (++puts === 1) return response({ ok: false, uncertain: true, error: "Save unconfirmed" }, 503);
    return response(body(paused));
  });
  vi.stubGlobal("fetch", fetcher);
  await mount();
  await toggle();
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => renderer!.unmount());
  await mount();
  await toggle();
  const writes = fetcher.mock.calls.filter(([, options]) => options?.method === "PUT");
  expect(writes).toHaveLength(2);
  expect(writes[1][1].body).toBe(writes[0][1].body);
  expect(JSON.parse(writes[0][1].body).mutation.adoptionKey).toMatch(/^journal-save:/);
});

test("a save for a previous familiar cannot open activation review on the current card", async () => {
  let finishSave: (value: ReturnType<typeof response>) => void = () => {};
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "PUT"
    ? new Promise<ReturnType<typeof response>>(resolve => { finishSave = resolve; }) : response(body())));
  await mount();
  await toggle();
  await act(async () => renderer!.update(<JournalAutomationCard familiarId="nova" familiarName="Nova" />));
  await act(async () => finishSave(response(body(paused))));
  expect(confirm).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: "switch" }).props["aria-label"]).toBe("Daily reflection for Nova");
  expect(renderer!.root.findByProps({ role: "switch" }).props.disabled).toBe(false);
});

test("changing familiar while activation confirmation is open prevents dispatch", async () => {
  let decide: (value: boolean) => void = () => {};
  confirm.mockImplementation(() => new Promise<boolean>(resolve => { decide = resolve; }));
  const fetcher = vi.fn(async (_url, options) => response(options?.method === "PUT" ? body(paused) : body()));
  vi.stubGlobal("fetch", fetcher);
  await mount();
  await toggle();
  expect(confirm).toHaveBeenCalledOnce();
  await act(async () => renderer!.update(<JournalAutomationCard familiarId="nova" familiarName="Nova" />));
  await act(async () => decide(true));
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
});

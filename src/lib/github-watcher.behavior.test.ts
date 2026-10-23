import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { configureGithubWatcher, startGithubWatcher, stopGithubWatcher, tickGithubWatcher } from "./github-watcher";
import { withinDeadline } from "./async-deadline";

const fixtures = vi.hoisted(() => ({
  subscriptions: vi.fn(), patch: vi.fn(), token: vi.fn(), cursor: vi.fn(),
  inbox: vi.fn(), create: vi.fn(), broadcast: vi.fn(),
}));
vi.mock("@/lib/github-subscriptions", async (original) => ({
  ...await original<typeof import("./github-subscriptions")>(),
  loadSubscriptions: fixtures.subscriptions, patchSubscriptions: fixtures.patch,
  updateCursor: fixtures.cursor,
}));
vi.mock("@/lib/github-token", () => ({ resolveGitHubToken: fixtures.token }));
vi.mock("@/lib/cave-inbox", () => ({ loadInbox: fixtures.inbox, createItem: fixtures.create }));
vi.mock("@/lib/inbox-scheduler", () => ({ broadcastCreated: fixtures.broadcast }));

const before = "2026-10-19T00:00:00Z";
const newest = "2026-10-20T00:00:00Z";
const pr = { number: 1, title: "Synthetic change", html_url: "https://github.com/fixture/second/pull/1", created_at: newest };
const nativeFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  delete globalThis.__githubWatcher;
  fixtures.subscriptions.mockResolvedValue({
    enabled: true, repos: ["fixture/first", "fixture/second"],
    events: { prOpened: true, ciCompleted: false },
    cursors: { "fixture/first": { prOpenedAt: before }, "fixture/second": { prOpenedAt: before } },
  });
  fixtures.token.mockReturnValue("synthetic-token");
  fixtures.patch.mockImplementation(async (patch) => {
    const subs = await fixtures.subscriptions();
    Object.assign(subs, patch);
    return subs;
  });
  fixtures.cursor.mockResolvedValue(undefined);
  fixtures.inbox.mockResolvedValue({ items: [] });
  fixtures.create.mockImplementation(async (item) => item);
});
afterEach(async () => {
  await stopGithubWatcher();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  delete globalThis.__githubWatcher;
});

test.each(["disabled", "no repositories", "no events"])("%s startup owns no polling timer", async (reason) => {
  const subs = await fixtures.subscriptions();
  if (reason === "disabled") subs.enabled = false;
  if (reason === "no repositories") subs.repos = [];
  if (reason === "no events") subs.events = { prOpened: false, ciCompleted: false };
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await startGithubWatcher();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("an already cancelled read never invokes work or retains a deadline", async () => {
  const work = vi.fn();
  const controller = new AbortController();
  controller.abort();
  expect(await withinDeadline(work, Date.now() + 8_000, { signal: controller.signal }))
    .toEqual({ state: "unavailable", value: null });
  expect(work).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("cancelling a read releases its deadline even when the transport ignores abort", async () => {
  const controller = new AbortController();
  let readSignal: AbortSignal | undefined;
  let settled = false;
  const read = withinDeadline(async (signal) => {
    readSignal = signal;
    return new Promise<never>(() => {});
  }, Date.now() + 8_000, { signal: controller.signal }).then(result => {
    settled = true;
    return result;
  });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(true);
  expect(readSignal?.aborted).toBe(true);
  expect(await read).toEqual({ state: "unavailable", value: null });
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["headers", "body"])("the settings API disables a pending %s read without late notifications", async (phase) => {
  const subs = await fixtures.subscriptions();
  subs.enabled = false;
  const { PATCH } = await import("../app/api/github/subscriptions/route");
  const patch = (enabled: boolean) => PATCH(new Request("http://localhost/api/github/subscriptions", {
    method: "PATCH", headers: { host: "localhost", "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ enabled }),
  }));
  let complete!: (value: unknown) => void;
  const deferred = new Promise(resolve => { complete = resolve; });
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn((_url, options) => {
    signal = options.signal;
    return phase === "headers" ? deferred : Promise.resolve({ ok: true, json: () => deferred });
  });
  vi.stubGlobal("fetch", fetcher);
  expect((await patch(true)).status).toBe(200);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledOnce();
  expect((await patch(false)).status).toBe(200);
  complete(phase === "headers" ? Response.json([pr]) : [pr]);
  await vi.advanceTimersByTimeAsync(0);
  expect(signal?.aborted).toBe(true);
  expect(fixtures.create).not.toHaveBeenCalled();
  expect(fixtures.broadcast).not.toHaveBeenCalled();
  expect(fixtures.cursor).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("repeated start, disable and re-enable keep one timer and preserve cursors", async () => {
  const subs = await fixtures.subscriptions();
  const cursors = structuredClone(subs.cursors);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([])));
  await Promise.all([startGithubWatcher(), startGithubWatcher(), startGithubWatcher()]);
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  for (let index = 0; index < 20; index++) {
    await configureGithubWatcher({ enabled: false });
    expect(vi.getTimerCount()).toBe(0);
    await configureGithubWatcher({ enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
  }
  expect(subs.cursors).toEqual(cursors);
  expect(fixtures.create).not.toHaveBeenCalled();
  await stopGithubWatcher();
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["notification", "cursor"])("configuration drains an admitted %s write before saving", async (kind) => {
  const subs = await fixtures.subscriptions();
  subs.repos = ["fixture/first"];
  let finish!: () => void;
  const writing = new Promise<void>(resolve => { finish = resolve; });
  const writer = kind === "notification" ? fixtures.create : fixtures.cursor;
  writer.mockImplementationOnce(async (input) => { await writing; return input; });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(kind === "notification" ? [pr] : [])));
  const tick = tickGithubWatcher();
  await vi.advanceTimersByTimeAsync(0);
  expect(writer).toHaveBeenCalledOnce();
  let configured = false;
  const update = configureGithubWatcher({ enabled: false }).then(() => { configured = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(configured).toBe(false);
  expect(fixtures.patch).not.toHaveBeenCalled();
  finish();
  await update;
  await tick;
  expect(fixtures.patch).toHaveBeenCalledOnce();
  expect(configured).toBe(true);
  if (kind === "notification") {
    expect(fixtures.broadcast).toHaveBeenCalledOnce();
    expect(fixtures.cursor).not.toHaveBeenCalled();
  }
  expect(vi.getTimerCount()).toBe(0);
});

test("a pending inbox read does not block disablement or publish after it", async () => {
  let finish!: (value: { items: never[] }) => void;
  fixtures.inbox.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([pr])));
  const tick = tickGithubWatcher();
  await vi.advanceTimersByTimeAsync(0);
  expect(fixtures.inbox).toHaveBeenCalledOnce();
  let configured = false;
  const update = configureGithubWatcher({ enabled: false }).then(() => { configured = true; });
  await vi.advanceTimersByTimeAsync(0);
  const disabledWithoutRead = configured;
  finish({ items: [] });
  await update;
  await tick;
  expect(disabledWithoutRead).toBe(true);
  expect(fixtures.create).not.toHaveBeenCalled();
  expect(fixtures.cursor).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("removing a repository fences its pending response and cursor", async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn().mockReturnValueOnce(pending)
    .mockImplementation(async () => Response.json([]));
  vi.stubGlobal("fetch", fetcher);
  await startGithubWatcher();
  await vi.advanceTimersByTimeAsync(0);
  await configureGithubWatcher({ repos: ["fixture/second"] });
  finish(Response.json([pr]));
  await vi.advanceTimersByTimeAsync(0);
  expect(fixtures.create).not.toHaveBeenCalled();
  expect(fixtures.cursor.mock.calls.map(([repo]) => repo)).toEqual(["fixture/second"]);
  expect(vi.getTimerCount()).toBe(1);
});

test("a late old read cannot release the new single flight after re-enable", async () => {
  let finishOld!: (value: Response) => void;
  const old = new Promise<Response>(resolve => { finishOld = resolve; });
  const fetcher = vi.fn().mockReturnValueOnce(old).mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("fetch", fetcher);
  await startGithubWatcher();
  await vi.advanceTimersByTimeAsync(0);
  await configureGithubWatcher({ enabled: false });
  await configureGithubWatcher({ enabled: true });
  await vi.advanceTimersByTimeAsync(0);
  finishOld(Response.json([pr]));
  await vi.advanceTimersByTimeAsync(0);
  await tickGithubWatcher();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fixtures.create).not.toHaveBeenCalled();
  expect(fixtures.cursor).not.toHaveBeenCalled();
  await stopGithubWatcher();
  expect(vi.getTimerCount()).toBe(0);
});

test("concurrent settings changes settle in save order with one final timer", async () => {
  const subs = await fixtures.subscriptions();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([])));
  await Promise.all([
    configureGithubWatcher({ enabled: true }),
    configureGithubWatcher({ enabled: false }),
    configureGithubWatcher({ enabled: true }),
  ]);
  await vi.advanceTimersByTimeAsync(0);
  expect(fixtures.patch.mock.calls.map(([patch]) => patch.enabled)).toEqual([true, false, true]);
  expect(subs.enabled).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
});

test("startup concurrent with the first settings change cannot duplicate the interval", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([])));
  await Promise.all([
    configureGithubWatcher({ enabled: true }),
    startGithubWatcher(),
  ]);
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  await stopGithubWatcher();
  expect(vi.getTimerCount()).toBe(0);
});

test("a rejected settings save reconciles the stored configuration without retrying the write", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([])));
  await startGithubWatcher();
  fixtures.patch.mockRejectedValueOnce(new Error("synthetic save failure"));
  await expect(configureGithubWatcher({ enabled: false })).rejects.toThrow("synthetic save failure");
  await vi.advanceTimersByTimeAsync(0);
  expect(fixtures.patch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(1);
  await configureGithubWatcher({ enabled: false });
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["startup", "poll", "failed save"])("an unavailable settings file during %s recovers without becoming disabled", async (phase) => {
  const root = await mkdtemp(path.join(tmpdir(), "github-watcher-read-"));
  const file = path.join(root, "subscriptions.json");
  vi.stubEnv("COVEN_GITHUB_SUBSCRIPTIONS_PATH", file);
  const store = await vi.importActual<typeof import("./github-subscriptions")>("./github-subscriptions");
  fixtures.subscriptions.mockImplementation(store.loadSubscriptions);
  fixtures.patch.mockImplementation(store.patchSubscriptions);
  const fetcher = vi.fn().mockImplementation(async () => Response.json([]));
  vi.stubGlobal("fetch", fetcher);
  try {
    await store.patchSubscriptions({
      enabled: true, repos: ["fixture/first"], events: { prOpened: true, ciCompleted: false },
    });
    const saved = await readFile(file, "utf8");
    if (phase !== "startup") {
      await startGithubWatcher();
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    }
    await writeFile(file, "{unavailable");
    if (phase === "startup") await startGithubWatcher();
    if (phase === "poll") await expect(tickGithubWatcher()).rejects.toThrow();
    if (phase === "failed save") {
      await expect(configureGithubWatcher({ enabled: false })).rejects.toThrow();
    }
    expect(vi.getTimerCount()).toBe(1);
    expect(await readFile(file, "utf8")).toBe("{unavailable");
    const reads = fetcher.mock.calls.length;
    await writeFile(file, saved);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(reads + 1));
    expect((await store.loadSubscriptions()).enabled).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await configureGithubWatcher({ enabled: false });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await stopGithubWatcher();
    await rm(root, { recursive: true, force: true });
  }
});

test("repository removal cannot resurrect a cursor from an admitted real store write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "github-watcher-"));
  const file = path.join(root, "subscriptions.json");
  vi.stubEnv("COVEN_GITHUB_SUBSCRIPTIONS_PATH", file);
  const store = await vi.importActual<typeof import("./github-subscriptions")>("./github-subscriptions");
  fixtures.subscriptions.mockImplementation(store.loadSubscriptions);
  fixtures.patch.mockImplementation(store.patchSubscriptions);
  fixtures.cursor.mockImplementation(store.updateCursor);
  let finish!: () => void;
  const writing = new Promise<void>(resolve => { finish = resolve; });
  try {
    await store.patchSubscriptions({
      enabled: true, repos: ["fixture/first"], events: { prOpened: true, ciCompleted: false },
    });
    await store.updateCursor("fixture/first", { prOpenedAt: before });
    fixtures.cursor.mockImplementationOnce(async (...args) => {
      await writing;
      return store.updateCursor(...args as Parameters<typeof store.updateCursor>);
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([])));
    const tick = tickGithubWatcher();
    await vi.waitFor(() => expect(fixtures.cursor).toHaveBeenCalledOnce());
    const update = configureGithubWatcher({ repos: ["fixture/second"], enabled: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixtures.patch).not.toHaveBeenCalled();
    finish();
    await tick;
    await update;
    const persisted = JSON.parse(await readFile(file, "utf8"));
    expect(persisted.repos).toEqual(["fixture/second"]);
    expect(persisted.enabled).toBe(false);
    expect(persisted.cursors).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    finish();
    await stopGithubWatcher();
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["headers", "body"])("a stalled %s read releases the tick and ignores late results", async (phase) => {
  let completeLate!: (value: unknown) => void;
  const late = new Promise<unknown>(resolve => { completeLate = resolve; });
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn()
    .mockImplementationOnce((_url, options) => {
      signal = options.signal;
      return phase === "headers" ? late : Promise.resolve({ ok: true, json: () => late });
    })
    .mockResolvedValueOnce(Response.json([pr]));
  vi.stubGlobal("fetch", fetcher);
  let settled = false;
  const tick = tickGithubWatcher().then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(0);
  await tickGithubWatcher();
  expect(fetcher).toHaveBeenCalledTimes(1); // Still single flight.
  await vi.advanceTimersByTimeAsync(7_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  await tick;
  expect(signal?.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fixtures.create).toHaveBeenCalledOnce(); // The later repository recovered.
  expect(fixtures.cursor).toHaveBeenCalledWith("fixture/first", {
    prOpenedAt: before, ciCompletedAt: null, seenRunIds: [],
  });
  expect(fixtures.cursor).toHaveBeenCalledWith("fixture/second", {
    prOpenedAt: newest, ciCompletedAt: null, seenRunIds: [],
  });
  const created = fixtures.create.mock.calls.length;
  const cursors = fixtures.cursor.mock.calls.length;
  const lateResponse = Response.json([pr]);
  const readLate = vi.spyOn(lateResponse, "json");
  const cancelLate = vi.spyOn(lateResponse.body!, "cancel");
  completeLate(phase === "headers" ? lateResponse : [pr]);
  await vi.advanceTimersByTimeAsync(0);
  expect(readLate).not.toHaveBeenCalled();
  if (phase === "headers") expect(cancelLate).toHaveBeenCalledOnce();
  expect(fixtures.create).toHaveBeenCalledTimes(created);
  expect(fixtures.cursor).toHaveBeenCalledTimes(cursors);
  fetcher.mockImplementation(async () => Response.json([]));
  await tickGithubWatcher();
  expect(fetcher).toHaveBeenCalledTimes(4); // Subsequent ticks are admitted.
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["disabled", "no repositories", "no events", "no token"])("%s performs no network reads", async (reason) => {
  const subs = await fixtures.subscriptions();
  if (reason === "disabled") subs.enabled = false;
  if (reason === "no repositories") subs.repos = [];
  if (reason === "no events") subs.events.prOpened = false;
  if (reason === "no token") fixtures.token.mockReturnValue(null);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await tickGithubWatcher();
  expect(fetcher).not.toHaveBeenCalled();
  expect(fixtures.create).not.toHaveBeenCalled();
  expect(fixtures.cursor).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("a successful read preserves notification deduplication and clears the deadline", async () => {
  fixtures.inbox.mockResolvedValue({ items: [{ auto: "github-sub:pr-opened:fixture/second#1" }] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([pr])));
  await tickGithubWatcher();
  expect(fixtures.create).not.toHaveBeenCalled();
  expect(fixtures.cursor).toHaveBeenCalledWith("fixture/second", {
    prOpenedAt: newest, ciCompletedAt: null, seenRunIds: [],
  });
  expect(vi.getTimerCount()).toBe(0);
});

test("an error response releases its unconsumed body without advancing its cursor", async () => {
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
    .mockResolvedValueOnce(Response.json([])));
  await tickGithubWatcher();
  expect(cancel).toHaveBeenCalledOnce();
  expect(fixtures.cursor).toHaveBeenCalledWith("fixture/first", {
    prOpenedAt: before, ciCompletedAt: null, seenRunIds: [],
  });
  expect(fixtures.create).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("a real partial HTTP body is cancelled and the next repository is polled", { timeout: 15_000 }, async () => {
  vi.useRealTimers();
  let closed!: () => void;
  const bodyClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url?.includes("fixture/first")) {
      response.write("[");
      response.once("close", closed);
    } else response.end("[]");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing loopback address");
  let requests = 0;
  vi.stubGlobal("fetch", (input: string, options: RequestInit) => {
    requests += 1;
    const url = new URL(input);
    return nativeFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, options);
  });
  try {
    await tickGithubWatcher();
    await bodyClosed;
    expect(requests).toBe(2);
    expect(fixtures.create).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("stopping the watcher closes a real pending HTTP body and its timer", async () => {
  vi.useRealTimers();
  let entered!: () => void;
  let closed!: () => void;
  const bodyEntered = new Promise<void>(resolve => { entered = resolve; });
  const bodyClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write("[");
    response.once("close", closed);
    entered();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing loopback address");
  vi.stubGlobal("fetch", (_input: string, options: RequestInit) =>
    nativeFetch(`http://127.0.0.1:${address.port}`, options));
  try {
    await startGithubWatcher();
    await bodyEntered;
    await stopGithubWatcher();
    await bodyClosed;
    expect(fixtures.create).not.toHaveBeenCalled();
    expect(fixtures.cursor).not.toHaveBeenCalled();
  } finally {
    await stopGithubWatcher();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

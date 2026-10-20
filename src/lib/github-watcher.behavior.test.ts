import { createServer } from "node:http";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tickGithubWatcher } from "./github-watcher";

const fixtures = vi.hoisted(() => ({
  subscriptions: vi.fn(), token: vi.fn(), cursor: vi.fn(),
  inbox: vi.fn(), create: vi.fn(), broadcast: vi.fn(),
}));
vi.mock("@/lib/github-subscriptions", async (original) => ({
  ...await original<typeof import("./github-subscriptions")>(),
  loadSubscriptions: fixtures.subscriptions, updateCursor: fixtures.cursor,
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
  globalThis.__githubWatcherTicking = false;
  fixtures.subscriptions.mockResolvedValue({
    enabled: true, repos: ["fixture/first", "fixture/second"],
    events: { prOpened: true, ciCompleted: false },
    cursors: { "fixture/first": { prOpenedAt: before }, "fixture/second": { prOpenedAt: before } },
  });
  fixtures.token.mockReturnValue("synthetic-token");
  fixtures.cursor.mockResolvedValue(undefined);
  fixtures.inbox.mockResolvedValue({ items: [] });
  fixtures.create.mockImplementation(async (item) => item);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  delete globalThis.__githubWatcherTicking;
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
  expect(globalThis.__githubWatcherTicking).toBe(false);
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
  expect(globalThis.__githubWatcherTicking).toBe(false);
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
    expect(globalThis.__githubWatcherTicking).toBe(false);
    expect(fixtures.create).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

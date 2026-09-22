// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DashboardSurface } from "./dashboard-surface";
import { BentoDashboard } from "./bento-dashboard";
import { buildDashboardModel } from "@/lib/dashboard-model";

const hooks = vi.hoisted(() => ({ poll: null }));
vi.mock("@/lib/use-pausable-poll", () => ({ usePausablePoll: callback => { hooks.poll = callback; } }));
vi.mock("@/lib/use-minute-tick", () => ({ useMinuteTick: () => {} }));
vi.mock("@/lib/user-profile", () => ({ useUserProfile: () => null, userAvatarUrl: () => null, userDisplayName: () => "Val" }));
vi.mock("@/lib/use-familiar-contracts", () => ({ useFamiliarContracts: () => ({}) }));
vi.mock("@/lib/canonical-memory-resources", () => ({ loadCanonicalMemoryList: async () => ({ state: "ready", entries: [] }) }));
vi.mock("@/components/ui/heat-tip", () => ({ useHeatTip: () => ({ gridProps: {}, tip: null }) }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let requests;
let deferMetrics;
const item = { id: "ask", kind: "reminder", title: "Review the release", status: "fired", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const card = { id: "task", title: "Approve the task", status: "review", familiarId: null, updatedAt: "2026-09-15T00:00:00Z" };
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const boardText = () => text(renderer.root.findByProps({ className: "bd-cell bd-board" }));
async function mount(element = <DashboardSurface />) { await act(async () => { renderer = create(element); }); }
async function reply(url, payload, ok = true) {
  const request = requests.find(r => r.url === url && !r.done);
  expect(request).toBeDefined();
  request.done = true;
  await act(async () => { request.resolve({ ok, json: async () => payload }); });
}
async function poll() { await act(async () => { void hooks.poll(); }); }
const stat = label => text(renderer.root.findAllByProps({ className: "bd-cell bd-stat" }).find(node => text(node.findByProps({ className: "bd-label" })) === label).findByProps({ className: "bd-stat-value" }));
beforeEach(() => {
  requests = [];
  deferMetrics = false;
  vi.stubGlobal("fetch", vi.fn((url, options) => {
    if (url === "/api/inbox" || url === "/api/board" || (deferMetrics && ["/api/sessions/list", "/api/familiars", "/api/projects"].includes(url))) return new Promise(resolve => requests.push({ url, resolve, signal: options.signal }));
    return Promise.resolve({ ok: true, headers: new Headers(), json: async () => ({ ok: true, sessions: [], familiars: [], projects: [], items: [] }) });
  }));
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = null; vi.unstubAllGlobals(); });

test("embedded dashboard makes one inbox read and waits for both attention sources before all clear", async () => {
  await mount();
  expect(requests.filter(r => r.url === "/api/inbox")).toHaveLength(1);
  expect(boardText()).not.toContain("all clear");
  await reply("/api/inbox", { items: [] });
  expect(boardText()).not.toContain("all clear");
  await reply("/api/board", { cards: [] });
  expect(boardText()).toContain("all clear");
  await poll();
  expect(requests.filter(r => r.url === "/api/inbox")).toHaveLength(2);
});

test("failed refreshes keep attention items and disclose incomplete data until recovery", async () => {
  await mount();
  await reply("/api/inbox", { items: [item] });
  await reply("/api/board", { cards: [card] });
  expect(boardText()).toContain(item.title);
  expect(boardText()).toContain(card.title);
  await poll();
  await reply("/api/inbox", {}, false);
  await reply("/api/board", {}, false);
  expect(boardText()).toContain(item.title);
  expect(boardText()).toContain(card.title);
  expect(boardText()).toContain("unavailable");
  expect(boardText()).not.toContain("all clear");
  await poll();
  await reply("/api/inbox", { items: [] });
  await reply("/api/board", { cards: [] });
  expect(boardText()).not.toContain(item.title);
  expect(boardText()).not.toContain(card.title);
  expect(boardText()).toContain("all clear");
  expect(boardText()).not.toContain("unavailable");
});

test("malformed or unsuccessful initial data is not a confirmed empty board", async () => {
  await mount();
  await reply("/api/inbox", { ok: false, items: [] });
  await reply("/api/board", { cards: null });
  expect(boardText()).not.toContain("all clear");
  expect(boardText()).not.toContain("nothing running");
  expect(boardText()).toContain("unavailable");
});

test("standalone server seed remains visible before and after a failed initial inbox read", async () => {
  await mount(<BentoDashboard model={buildDashboardModel([item], new Date())} />);
  expect(boardText()).toContain(item.title);
  await reply("/api/inbox", {}, false);
  await reply("/api/board", { cards: [] });
  expect(boardText()).toContain(item.title);
  expect(boardText()).toContain("unavailable");
});

test("metrics wait for real data and preserve the last snapshot through an outage", async () => {
  deferMetrics = true;
  await mount();
  expect(stat("total sessions")).toBe("—");
  expect(stat("familiars")).toBe("—");
  await reply("/api/board", { cards: [] });
  await reply("/api/inbox", { items: [] });
  await reply("/api/sessions/list", { sessions: [{ id: "s1", familiarId: "sage", created_at: new Date().toISOString() }] });
  await reply("/api/familiars", { familiars: [{ id: "sage", display_name: "Sage" }] });
  await reply("/api/projects", { projects: [{ id: "p1" }] });
  expect(stat("total sessions")).toBe("1");
  expect(stat("familiars")).toBe("1");
  expect(stat("projects")).toBe("1");
  await poll();
  await reply("/api/board", { cards: [] });
  await reply("/api/inbox", { items: [] });
  await reply("/api/sessions/list", {}, false);
  await reply("/api/familiars", { ok: false, familiars: [] });
  await reply("/api/projects", { projects: null });
  expect(stat("total sessions")).toBe("1");
  expect(stat("familiars")).toBe("1");
  expect(stat("projects")).toBe("1");
  expect(text(renderer.toJSON())).toContain("Couldn't refresh");
  const retry = renderer.root.findAllByType("button").find(node => node.props["aria-label"] === "Retry dashboard refresh");
  expect(retry).toBeDefined();
  await act(async () => { retry.props.onClick(); });
  await reply("/api/sessions/list", { sessions: [] });
  await reply("/api/familiars", { familiars: [] });
  await reply("/api/projects", { projects: [] });
  expect(stat("total sessions")).toBe("0");
  expect(stat("familiars")).toBe("0");
  expect(stat("projects")).toBe("0");
  expect(text(renderer.toJSON())).not.toContain("Couldn't refresh");
});

test("refresh during an unfinished initial load does not duplicate its requests", async () => {
  await mount();
  await poll();
  expect(requests.filter(r => r.url === "/api/inbox")).toHaveLength(1);
  expect(requests.filter(r => r.url === "/api/board")).toHaveLength(1);
});

test("explicit retry replaces a partly failed load instead of waiting for slow sibling requests", async () => {
  deferMetrics = true;
  await mount();
  await reply("/api/sessions/list", {}, false);
  const previous = requests.slice();
  const retry = renderer.root.findAllByType("button").find(node => node.props["aria-label"] === "Retry dashboard refresh");
  await act(async () => { retry.props.onClick(); });
  expect(previous.every(request => request.signal.aborted)).toBe(true);
  expect(requests.filter(r => r.url === "/api/sessions/list")).toHaveLength(2);
});

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
async function poll() { await act(async () => hooks.poll()); }
beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (url === "/api/inbox" || url === "/api/board") return new Promise(resolve => requests.push({ url, resolve }));
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

// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("./research-mission-detail", () => ({ ResearchMissionDetail: () => null }));
vi.mock("./research-mission-list", () => ({ ResearchMissionList: () => null }));
vi.mock("./research-topic-discovery", () => ({ ResearchTopicDiscovery: () => null }));
vi.mock("./use-research-pane", () => ({
  useResearchPane: () => ({ width: 300, collapsed: false, setCollapsed: vi.fn(), separatorProps: {} }),
}));
vi.mock("./use-research-run-gateway", () => ({
  useResearchRunGateway: () => ({ status: "idle", eventState: null }),
}));
vi.mock("@/lib/feature-flags", () => ({ caveResearchTopicDiscovery: () => false }));

import { LiveRegionProvider } from "@/components/ui/live-region";
import { ResearchTabDesk } from "./research-tab-desk";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const renderers = [];
const selected = {
  id: "mission-a", title: "Research question", status: "running",
  iterations: [{ number: 1, sessionId: "executor-a" }],
};
function textOf(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node?.children ? textOf(node.children) : "";
}
function element(openSession, mission = selected) {
  return createElement(LiveRegionProvider, null, createElement(ResearchTabDesk, {
    context: { activeFamiliar: { id: "familiar-sidebar" }, openSession },
    research: { selected: mission, missions: [mission], selectedId: mission.id },
    onNavigate: vi.fn(),
  }));
}
async function mount(openSession) {
  let renderer;
  await act(async () => { renderer = create(element(openSession)); });
  renderers.push(renderer);
  return renderer;
}
async function runChatCommand(renderer) {
  await act(async () => {
    renderer.root.findByType("input").props.onChange({ target: { value: "/chat" } });
  });
  const command = renderer.root.findByProps({ role: "menuitem" });
  expect(textOf(command)).toContain("/chat");
  await act(async () => command.props.onClick());
}
beforeEach(() => {
  const window = new EventTarget();
  window.localStorage = { getItem: () => null, setItem: vi.fn() };
  vi.stubGlobal("window", window);
});
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount(); });
  vi.unstubAllGlobals();
});

test("/chat creates a discussion for the exact executor and navigates to the returned owner", async () => {
  const openSession = vi.fn();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({
    ok: true, sessionId: "discussion-a", familiarId: "familiar-owner",
  })));
  vi.stubGlobal("fetch", fetcher);
  const renderer = await mount(openSession);
  await runChatCommand(renderer);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/flows/discussion", expect.objectContaining({
    method: "POST", body: JSON.stringify({ sessionId: "executor-a" }),
  }));
  expect(openSession).toHaveBeenCalledExactlyOnceWith("discussion-a", "familiar-owner");
});

test("/chat surfaces API failure and never falls back to opening the executor", async () => {
  const openSession = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    ok: false, error: "Execution owner unavailable",
  }), { status: 503 })));
  const renderer = await mount(openSession);
  await runChatCommand(renderer);
  expect(openSession).not.toHaveBeenCalled();
  expect(textOf(renderer.toJSON())).toContain("Execution owner unavailable");
  expect(textOf(renderer.toJSON())).toContain("Couldn’t open discussion");
});

test("a late discussion response does not navigate away from a newly selected mission", async () => {
  const openSession = vi.fn();
  let resolve;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
  const renderer = await mount(openSession);
  await runChatCommand(renderer);
  await act(async () => renderer.update(element(openSession, {
    ...selected, id: "mission-b", iterations: [{ number: 1, sessionId: "executor-b" }],
  })));
  await act(async () => resolve(new Response(JSON.stringify({
    ok: true, sessionId: "discussion-a", familiarId: "familiar-owner",
  }))));
  expect(openSession).not.toHaveBeenCalled();
});

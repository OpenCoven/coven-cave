// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { createElement, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  search: "", research: null, replace: vi.fn(), patch: vi.fn(), navigate: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => "/",
  useRouter: () => state,
}));
vi.mock("./use-research-missions", () => ({ useResearchMissions: () => state.research }));
vi.mock("@/lib/role-surface-state", () => ({ useRoleSurfaceState: () => [{}, state.patch] }));
vi.mock("@/lib/use-surface-history", () => ({ useTrackedSurfaceValue: ({ onRestore }) => onRestore }));
vi.mock("./research-tab-desk", () => ({
  ResearchTabDesk: ({ research }) => createElement("div", { "data-desk-mission": research.selectedId }, "Desk"),
}));
vi.mock("./research-tab-prompt", () => ({ ResearchTabPrompt: () => createElement("div", null, "Prompt intake") }));
vi.mock("./research-tab-library", () => ({ ResearchTabLibrary: () => null }));
vi.mock("./research-tab-studio", () => ({ ResearchTabStudio: () => null }));
vi.mock("./research-tab-resources", () => ({ ResearchTabResources: () => null }));
vi.mock("../flow-executions-dialog", () => ({ FlowExecutionsDialog: () => null }));

import { ResearcherSurface } from "./researcher-surface";
import { FlowExecutionLink } from "../flow-execution-link";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const renderers = [];
function textOf(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node?.children ? textOf(node.children) : "";
}
function element(owner = "sage") {
  return createElement(ResearcherSurface, { context: {
    activeFamiliar: { id: owner }, runtimeState: { daemonRunning: true },
  } });
}
async function mount(owner) {
  let renderer;
  await act(async () => { renderer = create(element(owner)); });
  renderers.push(renderer);
  return renderer;
}
beforeEach(() => {
  state.search = "researchMission=target&flowFamiliar=sage";
  state.research = { loading: false, error: null, missions: [], selectedId: "unrelated", select: vi.fn(), load: vi.fn() };
  state.replace.mockReset();
  state.navigate.mockReset();
  vi.stubGlobal("window", {
    localStorage: { getItem: () => "prompt", setItem: vi.fn() },
    location: { search: `?${state.search}`, pathname: "/", hash: "" },
    history: { replaceState: vi.fn((_state, _title, href) => {
      const url = new URL(href, "http://localhost");
      window.location.search = url.search;
      window.location.hash = url.hash;
      state.search = url.search.slice(1);
    }) },
  });
});
afterEach(async () => {
  await act(async () => renderers.splice(0).forEach((renderer) => renderer.unmount()));
  vi.unstubAllGlobals();
});

test("a mission link overrides a saved Prompt tab and selects only the exact loaded mission", async () => {
  state.research.missions = [
    { id: "unrelated", familiarId: "sage", status: "completed" },
    { id: "target", familiarId: "sage", status: "running" },
  ];
  const renderer = await mount();
  expect(state.research.select).toHaveBeenCalledExactlyOnceWith("target");
  expect(window.localStorage.setItem).toHaveBeenCalledWith("cave:research:tab", "desk");
  expect(textOf(renderer.toJSON())).not.toContain("Prompt intake");
});

test("waits for loading and familiar ownership instead of selecting an unrelated mission", async () => {
  state.research.loading = true;
  const renderer = await mount("other");
  expect(state.research.select).not.toHaveBeenCalled();
  expect(textOf(renderer.toJSON())).not.toContain("Prompt intake");
  state.research = { ...state.research, loading: false, missions: [{ id: "target", familiarId: "sage", status: "completed" }] };
  await act(async () => renderer.update(element("sage")));
  expect(state.research.select).toHaveBeenCalledExactlyOnceWith("target");
});

test("a missing linked mission reports unavailable and does not render another mission", async () => {
  state.research.missions = [{ id: "unrelated", familiarId: "sage", status: "completed" }];
  const renderer = await mount();
  expect(textOf(renderer.toJSON())).toContain("Research mission unavailable");
  expect(textOf(renderer.toJSON())).toContain("target");
  expect(renderer.root.findAllByProps({ "data-desk-mission": "unrelated" })).toHaveLength(0);
  expect(state.research.select).not.toHaveBeenCalled();
  expect(window.location.search).toContain("researchMission=target");
  expect(window.history.replaceState).not.toHaveBeenCalled();
});

test("an exact-id mission belonging to another familiar is not selected", async () => {
  state.research.missions = [{ id: "target", familiarId: "other", status: "completed" }];
  const renderer = await mount();
  expect(state.research.select).not.toHaveBeenCalled();
  expect(textOf(renderer.toJSON())).toContain("Research mission unavailable");
});

test("a new mission query is handled without remounting the Research surface", async () => {
  state.research.missions = [{ id: "target", familiarId: "sage", status: "running" }];
  const renderer = await mount();
  state.search = "researchMission=second&flowFamiliar=sage";
  state.research = { ...state.research, missions: [...state.research.missions, { id: "second", familiarId: "sage", status: "completed" }] };
  await act(async () => renderer.update(element()));
  expect(state.research.select.mock.calls).toEqual([["target"], ["second"]]);
});

test("dismissal clears only Research link keys and preserves unrelated URL state", async () => {
  state.search = "researchMission=target&flowFamiliar=sage&keep=yes";
  window.location.search = `?${state.search}`;
  window.location.hash = "#keep";
  const renderer = await mount();
  const dismiss = renderer.root.findAllByType("button").find((button) => textOf(button).includes("Back to research"));
  await act(async () => dismiss.props.onClick());
  expect(window.location.search).toBe("?keep=yes");
  expect(window.location.hash).toBe("#keep");
  expect(state.replace).toHaveBeenCalledExactlyOnceWith("/?keep=yes#keep", { scroll: false });
  expect(textOf(renderer.toJSON())).not.toContain("Research mission unavailable");
});

test("failed mission loading reports an error instead of selecting a stale mission", async () => {
  state.research.error = "Couldn’t load research";
  state.research.missions = [{ id: "target", familiarId: "sage", status: "running" }];
  const renderer = await mount();
  expect(state.research.select).not.toHaveBeenCalled();
  expect(textOf(renderer.toJSON())).toContain("Couldn’t load research");
});

function query(value) {
  state.search = value;
  window.location.search = value ? `?${value}` : "";
}

function LinkedWorkspace() {
  const [mode, setMode] = useState("home");
  const [owner, setOwner] = useState("other");
  return createElement("main", null,
    createElement(FlowExecutionLink, {
      familiars: [{ id: "sage" }, { id: "other" }],
      familiarsLoaded: true,
      activeFamiliarId: owner,
      onSelectFamiliar: setOwner,
      onNavigate: (next) => { state.navigate(next); setMode(next); },
      onOpenSession: vi.fn(),
    }),
    createElement("button", { onClick: () => { setMode("home"); setOwner("other"); } }, "Home"),
    mode === "surface:researcher-desk" ? element(owner) : createElement("div", null, "Home surface"),
  );
}

async function mountWorkspace() {
  let renderer;
  await act(async () => { renderer = create(createElement(LinkedWorkspace)); });
  renderers.push(renderer);
  return renderer;
}

async function refreshWorkspace(renderer) {
  await act(async () => renderer.update(createElement(LinkedWorkspace)));
}

async function confirmSelection(renderer, id = "target") {
  state.research = { ...state.research, selectedId: id };
  await refreshWorkspace(renderer);
  // Next's History integration notifies every useSearchParams subscriber.
  await refreshWorkspace(renderer);
}

test("consumes a Research link only after the exact selection settles, preserving query and hash", async () => {
  query("mode=surface%3Aresearcher-desk&researchMission=target&flowFamiliar=sage&keep=yes");
  window.location.hash = "#keep";
  state.research.missions = [{ id: "target", familiarId: "sage", status: "running" }];
  const renderer = await mountWorkspace();
  expect(state.research.select).toHaveBeenCalledExactlyOnceWith("target");
  expect(window.location.search).toContain("researchMission=target");
  expect(window.history.replaceState).not.toHaveBeenCalled();
  await confirmSelection(renderer);
  expect(window.location.search).toBe("?mode=surface%3Aresearcher-desk&keep=yes");
  expect(window.location.hash).toBe("#keep");
  expect(renderer.root.findByProps({ "data-desk-mission": "target" })).toBeTruthy();
});

test("the same Research notification reopens its owner after navigating elsewhere", async () => {
  const notification = "researchMission=target&flowFamiliar=sage";
  state.research.missions = [{ id: "target", familiarId: "sage", status: "running" }];
  const renderer = await mountWorkspace();
  await confirmSelection(renderer);
  await act(async () => renderer.root.findAllByType("button").find((button) => textOf(button) === "Home").props.onClick());
  expect(textOf(renderer.toJSON())).toContain("Home surface");
  query(notification);
  await refreshWorkspace(renderer);
  expect(state.navigate.mock.calls).toEqual([["surface:researcher-desk"], ["surface:researcher-desk"]]);
  expect(renderer.root.findByProps({ "data-desk-mission": "target" })).toBeTruthy();
  expect(window.location.search).toBe("");
});

test("switching missions does not prevent reopening the same first Research notification", async () => {
  state.research.missions = [
    { id: "target", familiarId: "sage", status: "running" },
    { id: "second", familiarId: "sage", status: "completed" },
  ];
  const renderer = await mountWorkspace();
  await confirmSelection(renderer);
  state.research = { ...state.research, selectedId: "second" };
  await refreshWorkspace(renderer);
  expect(renderer.root.findByProps({ "data-desk-mission": "second" })).toBeTruthy();
  expect(state.research.select).toHaveBeenCalledTimes(1);
  query("researchMission=target&flowFamiliar=sage");
  await refreshWorkspace(renderer);
  expect(state.research.select.mock.calls).toEqual([["target"], ["target"]]);
  await confirmSelection(renderer);
  expect(renderer.root.findByProps({ "data-desk-mission": "target" })).toBeTruthy();
});

test("failed Research reads retain their link for Retry and consume it only on recovery", async () => {
  state.research.error = "Couldn’t load research";
  state.research.missions = [{ id: "target", familiarId: "sage", status: "running" }];
  const renderer = await mountWorkspace();
  expect(window.location.search).toContain("researchMission=target");
  await act(async () => renderer.root.findAllByType("button").find((button) => textOf(button) === "Retry").props.onClick());
  expect(state.research.load).toHaveBeenCalledTimes(1);
  state.research = { ...state.research, error: null };
  await refreshWorkspace(renderer);
  expect(state.research.select).toHaveBeenCalledExactlyOnceWith("target");
  await confirmSelection(renderer);
  expect(window.location.search).toBe("");
});

test("Research consumption preserves a simultaneous Flow target and its owner", async () => {
  query("researchMission=target&flowFamiliar=sage&flowRun=run&flowSession=session&keep=yes");
  state.research.missions = [{ id: "target", familiarId: "sage", status: "running" }];
  const renderer = await mount();
  state.research = { ...state.research, selectedId: "target" };
  await act(async () => renderer.update(element()));
  expect(window.location.search).toBe("?flowFamiliar=sage&flowRun=run&flowSession=session&keep=yes");
});

test.each([
  "researchMission=second&flowFamiliar=sage&keep=new",
  "researchMission=target&flowFamiliar=other&keep=new",
])("a stale selection cannot consume a newer navigation: %s", async (nextQuery) => {
  state.research.missions = [{ id: "target", familiarId: "sage", status: "running" }];
  const renderer = await mount();
  // The browser has navigated, but this subscriber still holds the prior query.
  window.location.search = `?${nextQuery}`;
  state.research = { ...state.research, selectedId: "target" };
  await act(async () => renderer.update(element()));
  expect(window.location.search).toBe(`?${nextQuery}`);
  expect(window.history.replaceState).not.toHaveBeenCalled();
  expect(state.replace).not.toHaveBeenCalled();
});

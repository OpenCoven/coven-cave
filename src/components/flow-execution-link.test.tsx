// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => "/",
  useRouter: () => ({ replace: navigation.replace }),
}));
vi.mock("./flow-executions-dialog", () => ({
  FlowExecutionsDialog: (props) => createElement("dialog", { ...props, "data-flow-dialog": true }),
}));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, children, footerActions }) => open ? createElement("section", null, children, footerActions) : null,
}));

import { FlowExecutionLink } from "./flow-execution-link";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const renderers = [];
const familiar = { id: "sage", display_name: "Sage" };
async function mount(props = {}) {
  let renderer;
  const allProps = {
    familiars: [familiar], familiarsLoaded: true, activeFamiliarId: null,
    onSelectFamiliar: vi.fn(), onNavigate: vi.fn(), onOpenSession: vi.fn(), ...props,
  };
  await act(async () => { renderer = create(createElement(FlowExecutionLink, allProps)); });
  renderers.push(renderer);
  return { renderer, props: allProps };
}
beforeEach(() => {
  navigation.search = "";
  navigation.replace.mockReset();
  vi.stubGlobal("window", {
    location: { pathname: "/", search: "", hash: "#keep" },
    history: { replaceState: vi.fn((_state, _title, href) => {
      const url = new URL(href, "http://localhost");
      window.location.search = url.search;
      window.location.hash = url.hash;
      navigation.search = url.search.slice(1);
    }) },
  });
});
afterEach(async () => {
  await act(async () => { renderers.splice(0).forEach((renderer) => renderer.unmount()); });
  vi.unstubAllGlobals();
});
function query(value) {
  navigation.search = value;
  window.location.search = `?${value}`;
}

test("Workspace hosts a lazy execution link handler independent of ChatList", () => {
  const source = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
  expect(source.includes('import("./flow-execution-link")')).toBe(true);
  expect(source.match(/<FlowExecutionLink\b/g)).toHaveLength(1);
  expect(source).toContain("onOpenSession={openFamiliarSession}");
  expect(source.includes("primary && target && !executionOwnerLink")).toBe(true);
});

test("opens the exact linked run and transcript without opening Chat execution", async () => {
  query("mode=chat&flowRun=run-a&flowSession=source-a&flowFamiliar=sage");
  const { renderer, props } = await mount();
  const dialog = renderer.root.findByProps({ "data-flow-dialog": true });
  expect(dialog.props.initialRunId).toBe("run-a");
  expect(dialog.props.initialSessionId).toBe("source-a");
  expect(props.onSelectFamiliar).toHaveBeenCalledExactlyOnceWith("sage");
  expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith("chat");
  expect(props.onOpenSession).not.toHaveBeenCalled();
  await act(async () => dialog.props.onOpenSession("discussion-a", "sage"));
  expect(props.onOpenSession).toHaveBeenCalledExactlyOnceWith("discussion-a", "sage");
});

test("waits for an exact familiar match and never guesses from display names", async () => {
  query("flowRun=run-a&flowFamiliar=sage");
  const { renderer, props } = await mount({ familiars: [], familiarsLoaded: false });
  expect(props.onSelectFamiliar).not.toHaveBeenCalled();
  await act(async () => renderer.update(createElement(FlowExecutionLink, {
    ...props, familiars: [{ id: "not-sage", display_name: "sage" }], familiarsLoaded: true,
  })));
  expect(props.onSelectFamiliar).not.toHaveBeenCalled();
  await act(async () => renderer.update(createElement(FlowExecutionLink, {
    ...props, familiars: [familiar], familiarsLoaded: true,
  })));
  expect(props.onSelectFamiliar).toHaveBeenCalledExactlyOnceWith("sage");
});

test("closing clears only execution URL keys and suppresses immediate reopening", async () => {
  query("mode=chat&flowRun=run-a&flowSession=source-a&flowFamiliar=sage&keep=yes");
  const { renderer } = await mount();
  await act(async () => renderer.root.findByProps({ "data-flow-dialog": true }).props.onClose());
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/?mode=chat&keep=yes#keep", { scroll: false });
  expect(renderer.root.findAllByProps({ "data-flow-dialog": true })).toHaveLength(0);
});

test("dismissal commits URL cleanup even when the Next server navigation never completes", async () => {
  query("flowRun=engine&flowFamiliar=sage&keep=one");
  const { renderer, props } = await mount();
  await act(async () => renderer.root.findByProps({ "data-flow-dialog": true }).props.onClose());
  expect(window.location.search).toBe("?keep=one");
  expect(window.location.hash).toBe("#keep");
  expect(window.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/?keep=one#keep");
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/?keep=one#keep", { scroll: false });
  await act(async () => renderer.update(createElement(FlowExecutionLink, props)));
  expect(renderer.root.findAllByProps({ "data-flow-dialog": true })).toHaveLength(0);
});

test("reacts to a new URL target in the same mounted Workspace", async () => {
  const { renderer, props } = await mount();
  expect(renderer.root.findAllByProps({ "data-flow-dialog": true })).toHaveLength(0);
  query("mode=chat&flowRun=next-run");
  await act(async () => renderer.update(createElement(FlowExecutionLink, props)));
  expect(renderer.root.findByProps({ "data-flow-dialog": true }).props.initialRunId).toBe("next-run");
});

test("Research links select their exact owner and navigate to the Research surface, not Chat", async () => {
  query("mode=surface%3Aresearcher-desk&researchMission=mission-a&flowFamiliar=sage");
  const { renderer, props } = await mount();
  expect(props.onSelectFamiliar).toHaveBeenCalledExactlyOnceWith("sage");
  expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith("surface:researcher-desk");
  expect(props.onOpenSession).not.toHaveBeenCalled();
  expect(renderer.root.findAllByProps({ "data-flow-dialog": true })).toHaveLength(0);
});

test("an unknown Research owner never navigates into another familiar’s Research surface", async () => {
  query("mode=surface%3Aresearcher-desk&researchMission=mission-a&flowFamiliar=missing");
  const { props, renderer } = await mount();
  expect(props.onSelectFamiliar).not.toHaveBeenCalled();
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain("Research familiar unavailable");
});

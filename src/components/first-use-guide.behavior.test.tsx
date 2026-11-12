import { Children, createElement, isValidElement, useLayoutEffect, type ReactNode } from "react";
// @ts-expect-error -- This repository uses react-test-renderer without its declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFirstUseState } from "@/lib/first-use";
import { LiveRegionProvider } from "./ui/live-region";
import { FirstUseGuide } from "./first-use-guide";

const fixture = vi.hoisted(() => ({ firstUse: {} as Record<string, unknown>, access: "read" as "read" | "write" | null, runtime: "ready" as "ready" | "unavailable", transport: "ssh", runtimeFailure: false, reloadFrames: [] as boolean[] }));
vi.mock("./first-use-provider", () => ({ useFirstUse: () => fixture.firstUse }));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => ({ projects: [{ id: "p", name: "Practice", root: "/synthetic/practice" }], loading: false, error: null, reload() {} }) }));
// The guide's state and admission logic stay real; native focus/portal controls
// need a browser and are verified by the production journey suite.
vi.mock("./ui/modal", () => ({ Modal: function Modal({ children }: { children: ReactNode }) {
  // Capture committed actions before the guide's passive form-seeding effect.
  // A normal post-act assertion would miss a focus target removed by that effect.
  useLayoutEffect(() => {
    const hasReload = (nodes: ReactNode): boolean => {
      let found = false;
      Children.forEach(nodes, (node) => {
        if (!isValidElement<{ children?: ReactNode }>(node)) return;
        if (node.props.children === "Reload saved context" || hasReload(node.props.children)) found = true;
      });
      return found;
    };
    fixture.reloadFrames.push(hasReload(children));
  });
  return createElement("div", null, children);
} }));
vi.mock("./ui/select", () => ({ StandardSelect: ({ id, value, onChange, options }: { id: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) => createElement("select", { id, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }, options.map((entry) => createElement("option", { key: entry.value, value: entry.value }, entry.label))) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  fixture.access = "read";
  fixture.runtime = "ready";
  fixture.transport = "ssh";
  fixture.runtimeFailure = false;
  fixture.reloadFrames = [];
  fixture.firstUse = {
    open: true, busy: false, error: null, closeGuide() {}, refresh: async () => null, mutate: vi.fn(async () => true),
    payload: { state: { ...createFirstUseState(), revision: 2, outcome: "inspect", step: "context", defaults: { projectId: "p", familiarIds: ["nova"], actingFamiliarId: "nova" } }, resolution: { kind: "ready" }, access: [{ familiarId: "nova", level: "read", direct: "read", groups: [], supreme: true }], project: { id: "p", name: "Practice", root: "/synthetic/practice" } },
  };
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/project-grants") return Response.json({ ok: true, grants: fixture.access ? [{ familiarId: "nova", projectId: "p", access: fixture.access }] : [], accessGroups: [], supremeFamiliarId: "nova" });
    if (url.startsWith("/api/onboarding/journey?runtimeFamiliarId=")) return fixture.runtimeFailure || new URL(url, "http://localhost").searchParams.get("projectId") !== "p" ? Response.json({ ok: false }, { status: 503 }) : Response.json({ ok: true, runtime: { familiarId: "nova", harness: "hermes", transport: fixture.transport, state: fixture.runtime } });
    if (url === "/api/harnesses") return Response.json({ ok: true, harnesses: [{ id: "hermes", installed: false, chatSupported: true }] });
    throw new Error(`Unexpected guide request: ${url}`);
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
async function renderGuide() {
  await act(async () => {
    const element = createElement(LiveRegionProvider, null, createElement(FirstUseGuide, { familiars: [{ id: "nova", display_name: "Nova", role: "General", harness: "hermes" }], onManageFamiliars() {}, onUseDefaults() {} }));
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
function button(label: string) {
  return renderer!.root.findAllByType("button").find((entry: { children: unknown[] }) => entry.children.filter((child) => typeof child === "string").join("") === label)!;
}
function renderedText() { return JSON.stringify(renderer!.toJSON()); }

test("context restoration offers Reload only for a revision changed during an open review", async () => {
  await renderGuide();
  expect(fixture.reloadFrames).not.toContain(true);
  const payload = fixture.firstUse.payload as { state: { revision: number } };
  payload.state = { ...payload.state, revision: 3 };
  await renderGuide();
  expect(fixture.reloadFrames.at(-1)).toBe(true);
  expect(button("Reload saved context")).toBeDefined();
  expect(button("Save default context").props.disabled).toBe(true);
});

test.each(["ssh", "api"])("the guide saves an available %s actor even when its local CLI is absent", async (transport) => {
  fixture.transport = transport;
  await renderGuide();
  expect(button("Save default context").props.disabled).toBe(false);
  await act(async () => button("Save default context").props.onClick());
  expect(fixture.firstUse.mutate).toHaveBeenCalledWith({ kind: "context", defaults: { projectId: "p", familiarIds: ["nova"], actingFamiliarId: "nova" } }, 2);
});

test.each(["unavailable", "failed"])("the guide blocks context saving for an %s runtime report", async (kind) => {
  fixture.runtime = "unavailable";
  fixture.runtimeFailure = kind === "failed";
  await renderGuide();
  expect(button("Save default context").props.disabled).toBe(true);
  expect(button("Open setup")).toBeDefined();
});

test("a supreme familiar's Read grant stays Read in the context review", async () => {
  await renderGuide();
  expect(renderedText()).toContain("Read access");
  expect(renderedText()).not.toContain("Full access");
});

test("a supreme designation alone cannot save an ungranted default", async () => {
  fixture.access = null;
  await renderGuide();
  expect(renderedText()).toContain("No project access");
  expect(button("Save default context").props.disabled).toBe(true);
  expect(button("Review Read access for Nova")).toBeDefined();
});

test("the access review separates supreme designation from its Read grant and disables Build", async () => {
  const payload = fixture.firstUse.payload as { state: { step: string } };
  payload.state.step = "access";
  await renderGuide();
  expect(renderedText()).toContain("Read access");
  expect(renderedText()).toContain("through a direct grant");
  expect(renderedText()).not.toContain("through supreme-familiar policy");
  const build = renderer!.root.findAllByType("input").find((entry: { props: { type: string; disabled?: boolean } }) => entry.props.type === "radio" && entry.props.disabled);
  expect(build).toBeDefined();
});

import { createElement, type ReactNode } from "react";
// @ts-expect-error -- react-test-renderer has no declarations in this repository.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { advanceFirstUse, createQuickStartState, type FirstUseAction, type FirstUseState } from "@/lib/first-use";
import { LiveRegionProvider } from "./ui/live-region";
import { FirstUseGuide } from "./first-use-guide";
import { FirstUseAssistantPicker } from "./first-use-assistant-picker";
import { OnboardingRuntimeStep } from "./onboarding-runtime-step";

const fixture = vi.hoisted(() => ({ firstUse: {} as Record<string, unknown>, access: "read" as "read" | "write" | null, inheritedWrite: false, runtime: "ready", runtimeFailure: false, requests: [] as Array<{ url: string; body: Record<string, unknown> }>, refuseGrant: false, refuseSave: false, poll: undefined as undefined | (() => Promise<void>) }));
vi.mock("@/lib/use-pausable-poll", () => ({ usePausablePoll: (callback: () => Promise<void>, _interval: number, options: { enabled: boolean }) => { fixture.poll = options.enabled ? callback : undefined; } }));
vi.mock("./first-use-provider", () => ({ useFirstUse: () => fixture.firstUse }));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => ({ projects: [{ id: "p", name: "Practice", root: "/synthetic/practice" }, { id: "q", name: "Other", root: "/synthetic/other" }], loading: false, error: null, reload() {} }) }));
vi.mock("./ui/modal", () => ({ Modal: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("./directory-picker-modal", () => ({ DirectoryPickerModal: () => null }));
vi.mock("./ui/select", () => ({ StandardSelect: ({ id, value, onChange, options }: { id: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) => createElement("select", { id, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }, options.map((entry) => createElement("option", { key: entry.value, value: entry.value }, entry.label))) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
const defaults = { projectId: "p", familiarIds: ["nova"], actingFamiliarId: "nova" };
const onStartChat = vi.fn(() => true);
const onUseDefaults = vi.fn();
const onClose = vi.fn();
function payload() { return fixture.firstUse.payload as { state: FirstUseState; resolution: { kind: string }; project: { name: string; root: string }; access: unknown[] }; }
beforeEach(() => {
  fixture.access = "read"; fixture.inheritedWrite = false; fixture.runtime = "ready"; fixture.runtimeFailure = false; fixture.requests = []; fixture.refuseGrant = false; fixture.refuseSave = false;
  onStartChat.mockClear(); onUseDefaults.mockClear(); onClose.mockClear();
  fixture.poll = undefined;
  fixture.firstUse = {
    open: true, busy: false, error: null, closeGuide: onClose,
    refresh: async () => payload(),
    mutate: vi.fn(async (action: FirstUseAction, revision: number) => {
      fixture.firstUse.error = null;
      if (fixture.refuseSave && action.kind === "finish-setup") { fixture.firstUse.error = "Couldn't save setup. Retry."; return false; }
      const current = payload();
      if (current.state.revision !== revision) return false;
      current.state = advanceFirstUse(current.state, action);
      return true;
    }),
    payload: { state: { ...advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" }), defaults }, resolution: { kind: "ready" }, project: { name: "Practice", root: "/synthetic/practice" }, access: [] },
  };
  const storage = new Map<string, string>();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } }));
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      const body = JSON.parse(options.body as string); fixture.requests.push({ url, body });
      if (url === "/api/project-grants") {
        if (fixture.refuseGrant) return Response.json({ ok: false, error: "Access changed. Review it." }, { status: 409 });
        fixture.access = body.access;
        return Response.json({ ok: true });
      }
    }
    if (url === "/api/project-grants") return Response.json({ ok: true, grants: fixture.access ? [{ familiarId: "nova", projectId: "p", access: fixture.access }] : [], accessGroups: fixture.inheritedWrite ? [{ id: "builders", name: "Builders", memberFamiliarIds: ["nova"], projectGrants: [{ projectId: "p", access: "write" }] }] : [], supremeFamiliarId: "nova" });
    if (url.startsWith("/api/onboarding/journey?runtimeFamiliarId=")) return fixture.runtimeFailure ? Response.json({ ok: false }, { status: 503 }) : Response.json({ ok: true, runtime: { familiarId: "nova", harness: "hermes", transport: "ssh", state: fixture.runtime } });
    if (url === "/api/harnesses") return Response.json({ harnesses: [{ id: "hermes", installed: false, chatSupported: true }] });
    if (url.startsWith("/api/project-tree?")) return Response.json({ ok: true, entries: [{ name: "README.md", path: "/synthetic/practice/README.md", isDir: false }] });
    if (url.startsWith("/api/project-file?")) return Response.json({ ok: true, kind: "text", content: "# A real project overview" });
    throw new Error(`Unexpected guide request: ${url}`);
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
async function renderGuide() {
  await act(async () => {
    const element = createElement(LiveRegionProvider, null, createElement(FirstUseGuide, { familiars: [{ id: "nova", display_name: "Nova", role: "General", harness: "hermes" }], onManageFamiliars() {}, onUseDefaults, onStartChat }));
    if (renderer) renderer.update(element); else renderer = create(element);
  });
}
function button(label: string) { return renderer!.root.findAllByType("button").find((entry: { children: unknown[] }) => entry.children.filter((child) => typeof child === "string").join("") === label)!; }
function text() { return JSON.stringify(renderer!.toJSON()); }
async function selectAccess(value: string) { await act(async () => renderer!.root.findAllByType("input").find((entry: { props: { name: string; value: string } }) => entry.props.name === "setup-access" && entry.props.value === value)!.props.onChange()); }

test("short setup offers Read and Full without mandatory fictional practice", async () => {
  await renderGuide();
  expect(renderer!.root.findAllByType("input").filter((entry: { props: { name: string } }) => entry.props.name === "setup-access").map((entry: { props: { value: string } }) => entry.props.value)).toEqual(["read", "full"]);
  expect(text()).not.toContain("Practice outcome"); expect(text()).not.toContain("Wait for approval");
  expect(button("Continue with Read").props.disabled).toBe(true);
});
test("a failed progress read remains visible and retryable inside the guide", async () => {
  fixture.firstUse.payload = null;
  fixture.firstUse.error = "Saved context temporarily unavailable";
  await renderGuide();
  expect(text()).toContain("Saved context temporarily unavailable");
  expect(button("Retry")).toBeDefined();
});
test("another runtime's completed install cannot mark the selected runtime ready", async () => {
  let done = false;
  const ready = vi.fn();
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/harnesses") return Response.json({ harnesses: [{ id: "codex", installed: done, chatSupported: true }, { id: "claude", installed: false, chatSupported: true }] });
    if (url === "/api/onboarding/install") return Response.json({ status: "idle", npmBusy: !done, npmBusyLabel: "Codex" });
    if (url.endsWith("target=codex")) return Response.json({ status: done ? "done" : "running", ok: done });
    return Response.json({ status: "idle" });
  });
  await act(async () => { renderer = create(createElement(LiveRegionProvider, null, createElement(OnboardingRuntimeStep, { open: true, target: "claude", onReadyChange: ready }))); });
  expect(button("Install Claude Code").props.disabled).toBe(true);
  expect(fixture.poll).toBeDefined();
  done = true;
  await act(async () => fixture.poll!());
  expect(ready.mock.lastCall).toEqual([false]);
  expect(button("Install Claude Code").props.disabled).toBe(false);
});
test("changing the assistant during fresh setup keeps a single acting familiar", async () => {
  payload().state = createQuickStartState();
  await renderGuide();
  await act(async () => renderer!.root.findByType(FirstUseAssistantPicker).props.onCreated({ id: "sage", display_name: "Sage", harness: "hermes" }));
  await act(async () => renderer!.root.findByType(FirstUseAssistantPicker).props.onSelect("nova"));
  await act(async () => button("Choose a project").props.onClick());
  const checked = renderer!.root.findAllByType("input").filter((entry: { props: { type: string; checked: boolean } }) => entry.props.type === "checkbox" && entry.props.checked);
  expect(checked).toHaveLength(1);
});

test("blocked browser storage cannot complete setup with an unsaved access choice", async () => {
  await renderGuide(); await selectAccess("read");
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  await act(async () => button("Continue with Read").props.onClick());
  expect(payload().state.step).toBe("project");
  expect(onUseDefaults).not.toHaveBeenCalled();
  expect(text()).toContain("Couldn't save your access choice");
});

test("an uncertain familiar creation waits for authoritative refresh before retrying", async () => {
  let creates = 0;
  const created = vi.fn();
  const refreshed = vi.fn(async () => []);
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (url === "/api/harnesses") return Response.json({ harnesses: [{ id: "codex", installed: true, chatSupported: true }] });
    if (url === "/api/familiars" && options?.method === "POST") { creates++; return Response.json({ ok: false, error: "Connection lost" }, { status: 503 }); }
    throw new Error(`Unexpected request: ${url}`);
  });
  await act(async () => { renderer = create(createElement(LiveRegionProvider, null, createElement(FirstUseAssistantPicker, { familiars: [], selectedId: "", busy: false, onSelect() {}, onCreated: created, onRefresh: refreshed, onAdvanced() {} }))); });
  await act(async () => { const action = button("Create with Codex").props.onClick; action(); action(); });
  expect(creates).toBe(1); expect(created).not.toHaveBeenCalled();
  expect(button("Create with Codex").props.disabled).toBe(true);
  await act(async () => button("Refresh familiars").props.onClick());
  expect(refreshed).toHaveBeenCalledOnce();
  expect(button("Create with Codex").props.disabled).toBe(false);
});

test("the interactive preview reads a chosen file as the human without granting or dispatching", async () => {
  await renderGuide();
  await act(async () => button("README.md").props.onClick());
  expect(text()).toContain("# A real project overview");
  expect(fixture.requests).toEqual([]); expect(onStartChat).not.toHaveBeenCalled();
});
test("Retry preview retries a failed file read without requiring another selection", async () => {
  const original = globalThis.fetch;
  let reads = 0;
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (url.startsWith("/api/project-file?")) { reads++; return reads === 1 ? Response.json({ ok: false, error: "Try again" }, { status: 503 }) : Response.json({ ok: true, kind: "text", content: "Recovered file preview" }); }
    return original(url, options);
  });
  await renderGuide(); await act(async () => button("README.md").props.onClick());
  expect(text()).toContain("Try again");
  await act(async () => button("Retry preview").props.onClick());
  expect(text()).toContain("Recovered file preview");
});
test("a changed revision requires reloading without overwriting uncommitted choices", async () => {
  await renderGuide(); await selectAccess("read");
  payload().state = { ...payload().state, revision: 5 };
  await renderGuide();
  expect(button("Reload saved context")).toBeDefined(); expect(button("Continue with Read").props.disabled).toBe(true);
  expect(renderer!.root.findAllByType("input").find((entry: { props: { value: string } }) => entry.props.value === "read")!.props.checked).toBe(true);
});
test("an available SSH actor can finish Read setup without a local runtime or a grant mutation", async () => {
  await renderGuide(); await selectAccess("read");
  expect(button("Continue with Read").props.disabled).toBe(false);
  await act(async () => button("Continue with Read").props.onClick());
  expect(fixture.requests).toEqual([]);
  expect(payload().state).toMatchObject({ step: "complete", permissionMode: "read", defaults, practice: { verified: false } });
  expect(onUseDefaults).toHaveBeenCalledWith(defaults);
});
test.each(["unavailable", "failed"])("an %s runtime cannot save setup", async (kind) => {
  fixture.runtime = "unavailable"; fixture.runtimeFailure = kind === "failed";
  await renderGuide(); await selectAccess("read");
  expect(button("Continue with Read").props.disabled).toBe(true); expect(button("Open setup")).toBeDefined();
});
test("Full is an explicit write-grant action with the displayed direct grant as a precondition", async () => {
  await renderGuide(); await selectAccess("full");
  expect(fixture.requests).toEqual([]);
  await act(async () => button("Allow Full and continue").props.onClick());
  expect(fixture.requests).toEqual([{ url: "/api/project-grants", body: { targetFamiliarId: "nova", projectId: "p", access: "write", expectedAccess: "read" } }]);
  expect(payload().state.permissionMode).toBe("full"); expect(text()).toContain("Full access");
});

test("repeated activation admits only one grant and setup mutation", async () => {
  await renderGuide(); await selectAccess("full");
  const submit = button("Allow Full and continue").props.onClick;
  await act(async () => { await Promise.all([submit(), submit()]); });
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.firstUse.mutate).toHaveBeenCalledTimes(1);
});
test("a supreme designation alone creates no grant until explicit consent", async () => {
  fixture.access = null; await renderGuide();
  expect(fixture.requests).toEqual([]); expect(text()).toContain("Existing project grant: None");
  await selectAccess("read"); await act(async () => button("Allow Read and continue").props.onClick());
  expect(fixture.requests[0].body).toEqual({ targetFamiliarId: "nova", projectId: "p", access: "read", expectedAccess: null });
});
test("an inherited Full grant stays visible while the user selects Read chat mode", async () => {
  fixture.inheritedWrite = true; await renderGuide(); await selectAccess("read");
  expect(text()).toContain("Existing project grant: Full through Builders");
  await act(async () => button("Continue with Read").props.onClick());
  expect(fixture.requests).toEqual([]); expect(payload().state.permissionMode).toBe("read");
});
test("a stale grant clears consent and never completes setup", async () => {
  fixture.refuseGrant = true; await renderGuide(); await selectAccess("full");
  await act(async () => button("Allow Full and continue").props.onClick());
  expect(payload().state.step).toBe("project"); expect(text()).toContain("Access changed");
  expect(renderer!.root.findAllByType("input").filter((entry: { props: { name: string; checked: boolean } }) => entry.props.name === "setup-access" && entry.props.checked)).toHaveLength(0);
});
test("retry after a grant succeeds but setup save fails does not repeat that grant", async () => {
  fixture.refuseSave = true; await renderGuide(); await selectAccess("full");
  await act(async () => button("Allow Full and continue").props.onClick());
  expect(fixture.requests).toHaveLength(1); expect(payload().state.step).toBe("project");
  fixture.refuseSave = false;
  await act(async () => button("Retry").props.onClick());
  await act(async () => button("Continue with Full").props.onClick());
  expect(fixture.requests).toHaveLength(1); expect(payload().state.step).toBe("complete");
});
test("switching project clears the previous project's access choice", async () => {
  await renderGuide(); await selectAccess("full");
  await act(async () => renderer!.root.findByType("select").props.onChange({ target: { value: "q" } }));
  expect(renderer!.root.findAllByType("input").filter((entry: { props: { name: string; checked: boolean } }) => entry.props.name === "setup-access" && entry.props.checked)).toHaveLength(0);
  expect(fixture.requests).toEqual([]);
});
test("starter selection only prepares a draft and hands exact context to real Chat on demand", async () => {
  await renderGuide(); await selectAccess("read"); await act(async () => button("Continue with Read").props.onClick());
  const starter = renderer!.root.findAllByType("button").find((entry: { props: { className?: string }; children: unknown[] }) => entry.props.className?.includes("first-use-starter") && JSON.stringify(entry.children.filter((child) => typeof child === "string")).includes("Make a plan"));
  // Choose through the visible starter's strong title, not a fixture dispatch.
  const plan = starter ?? renderer!.root.findAllByType("button").find((entry: { props: { className?: string }; findAllByType: (name: string) => Array<{ children: string[] }> }) => entry.props.className?.includes("first-use-starter") && entry.findAllByType("strong").some((title) => title.children.join("") === "Make a plan"))!;
  await act(async () => plan.props.onClick());
  expect(onStartChat).not.toHaveBeenCalled();
  await act(async () => button("Open in Chat").props.onClick());
  expect(onStartChat).toHaveBeenCalledWith(defaults, expect.stringContaining("Help me plan")); expect(onClose).toHaveBeenCalled();
});

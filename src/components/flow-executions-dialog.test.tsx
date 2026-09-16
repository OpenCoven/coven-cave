// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, children, footerActions }) => open
    ? createElement("section", { role: "dialog" }, children, footerActions)
    : null,
}));

import { LiveRegionProvider } from "@/components/ui/live-region";
import { FlowExecutionsDialog, groupFlowRuns } from "./flow-executions-dialog";
import { isFlowSession } from "@/lib/flow-discussion";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const renderers = [];
function textOf(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node?.children ? textOf(node.children) : "";
}
const run = (id, overrides = {}) => ({
  id, flowId: "flow-a", flowName: "Daily brief", status: "succeeded",
  startedAt: "2026-09-05T10:00:00Z", source: "cave", sessionId: `source-${id}`,
  steps: [{ id: "gather", type: "agent", status: "succeeded", detail: "Two sources checked" }],
  ...overrides,
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
async function mount(props = {}) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(LiveRegionProvider, null, createElement(FlowExecutionsDialog, {
      open: true, onClose: vi.fn(), onOpenSession: vi.fn(), ...props,
    })));
  });
  renderers.push(renderer);
  return renderer;
}
function buttons(renderer, label) {
  return renderer.root.findAllByType("button").filter((button) => textOf(button.props.children) === label);
}
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount(); });
  vi.unstubAllGlobals();
});

describe("Flow execution history", () => {
  test("groups iterations by mission and ordinary runs by flow, without treating a title as ownership", () => {
    const groups = groupFlowRuns([
      run("one", { missionId: "mission-a", iteration: 1 }),
      run("two", { missionId: "mission-a", iteration: 2, flowId: "other-flow" }),
      run("retry"), run("original"),
    ]);
    expect(groups.map((group) => group.runs.map((item) => item.id))).toEqual([
      ["one", "two"], ["retry", "original"],
    ]);
    expect(isFlowSession({ origin: "flow" })).toBe(true);
    expect(isFlowSession({ origin: "cave", flow: { flowId: "f", runId: "r" } })).toBe(true);
    expect(isFlowSession({ origin: "cave", title: "Flow: my ordinary chat" })).toBe(false);
    expect(isFlowSession({ title: "Flow step: my ordinary chat" })).toBe(false);
  });

  test("does not load hidden history", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await mount({ open: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("shows runs and steps, reads a transcript without opening or promoting the source", async () => {
    const onOpenSession = vi.fn();
    const fetcher = vi.fn(async (url) => url === "/api/flows/runs"
      ? response({ ok: true, runs: [run("one")] })
      : response({ ok: true, transcript: "Read-only execution output" }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount({ onOpenSession });
    expect(textOf(renderer.toJSON())).toContain("Daily brief");
    expect(textOf(renderer.toJSON())).toContain("Two sources checked");
    await act(async () => buttons(renderer, "View transcript")[0].props.onClick());
    expect(fetcher).toHaveBeenCalledWith(
      "/api/flows/session-transcript?sessionId=source-one", expect.any(Object),
    );
    expect(textOf(renderer.toJSON())).toContain("Read-only execution output");
    expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  });

  test("Discuss opens only the returned conversation and familiar", async () => {
    const onOpenSession = vi.fn();
    const onClose = vi.fn();
    const fetcher = vi.fn(async (url) => url === "/api/flows/discussion"
      ? response({ ok: true, sessionId: "discussion-new", familiarId: "sage" })
      : response({ ok: true, transcript: "Run output" }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount({ initialSessionId: "executor-1", onOpenSession, onClose });
    await act(async () => buttons(renderer, "Discuss in Chat")[0].props.onClick());
    expect(fetcher).toHaveBeenCalledWith("/api/flows/discussion", expect.objectContaining({
      method: "POST", body: JSON.stringify({ sessionId: "executor-1" }),
    }));
    expect(onOpenSession).toHaveBeenCalledExactlyOnceWith("discussion-new", "sage");
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("step and retry sessions stay beneath their run and each opens its exact transcript", async () => {
    const fetcher = vi.fn(async (url) => url === "/api/flows/runs"
      ? response({ ok: true, runs: [run("engine", { sessionId: undefined })] })
      : response({ ok: true, transcript: "Retry output" }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount({ sessions: [
      { id: "step-original", familiarId: "sage", title: "Gather", origin: "flow", flow: { flowId: "flow-a", runId: "engine" } },
      { id: "step-retry", familiarId: "sage", title: "Gather retry", origin: "flow", flow: { flowId: "flow-a", runId: "engine" } },
      { id: "unrelated", title: "Flow: same-looking title", origin: "cave" },
    ] });
    expect(buttons(renderer, "View transcript")).toHaveLength(2);
    expect(textOf(renderer.toJSON())).toContain("Gather retry");
    expect(textOf(renderer.toJSON())).not.toContain("same-looking title");
    await act(async () => buttons(renderer, "View transcript")[1].props.onClick());
    expect(fetcher).toHaveBeenCalledWith(
      "/api/flows/session-transcript?sessionId=step-retry", expect.any(Object),
    );
  });

  test("failed discussion stays in the viewer and can be retried", async () => {
    const onOpenSession = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url) => url === "/api/flows/discussion"
      ? response({ ok: false, error: "Owner unavailable. Try again." }, 503)
      : response({ ok: true, transcript: "Run output" })));
    const renderer = await mount({ initialSessionId: "executor-1", onOpenSession });
    await act(async () => buttons(renderer, "Discuss in Chat")[0].props.onClick());
    expect(textOf(renderer.toJSON())).toContain("Owner unavailable. Try again.");
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(buttons(renderer, "Discuss in Chat")[0].props.disabled).toBeFalsy();
  });

  test("refuses a discussion response that retargets the source", async () => {
    const onOpenSession = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url) => url === "/api/flows/discussion"
      ? response({ ok: true, sessionId: "executor-1", familiarId: "sage" })
      : response({ ok: true, transcript: "" })));
    const renderer = await mount({ initialSessionId: "executor-1", onOpenSession });
    await act(async () => buttons(renderer, "Discuss in Chat")[0].props.onClick());
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(textOf(renderer.toJSON())).toContain("Couldn’t open discussion");
  });

  test("history failure is not shown as an empty collection and Retry recovers", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ ok: false, error: "History unavailable" }, 503))
      .mockResolvedValueOnce(response({ ok: true, runs: [] }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount();
    expect(textOf(renderer.toJSON())).toContain("Couldn’t load Flow runs");
    expect(textOf(renderer.toJSON())).not.toContain("No Flow runs yet");
    await act(async () => buttons(renderer, "Retry")[0].props.onClick());
    expect(textOf(renderer.toJSON())).toContain("No Flow runs yet");
  });

  test("an initial transcript remains accessible even if history is unavailable", async () => {
    const fetcher = vi.fn(async () => response({ ok: true, transcript: "Direct output" }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount({ initialSessionId: "source-direct" });
    expect(textOf(renderer.toJSON())).toContain("Direct output");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/flows/session-transcript?sessionId=source-direct",
    ]);
  });

  test("an exact engine-run link selects and expands only that run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      ok: true, runs: [run("unrelated"), run("target", { sessionId: undefined })],
    })));
    const renderer = await mount({ initialRunId: "target" });
    const disclosures = renderer.root.findAllByType("details");
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0].props.open).toBe(true);
    expect(textOf(renderer.toJSON())).toContain("Run target");
    expect(textOf(renderer.toJSON())).not.toContain("Run unrelated");
  });

  test("an evicted requested run shows an explicit warning instead of unrelated history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, runs: [run("other")] })));
    const renderer = await mount({ initialRunId: "evicted-run" });
    expect(textOf(renderer.toJSON())).toContain("Flow run unavailable");
    expect(textOf(renderer.toJSON())).toContain("evicted-run");
    expect(renderer.root.findAllByType("details")).toHaveLength(0);
  });

  test("a direct session target remains readable when its run history is gone", async () => {
    const fetcher = vi.fn(async () => response({ ok: true, transcript: "Durable source output" }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount({ initialRunId: "evicted-run", initialSessionId: "durable-source" });
    expect(textOf(renderer.toJSON())).toContain("Durable source output");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/flows/session-transcript?sessionId=durable-source",
    ]);
  });

  test("switching transcripts discards an earlier in-flight read", async () => {
    let resolveFirst;
    const fetcher = vi.fn((url) => url.includes("source-first")
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : Promise.resolve(response({ ok: true, transcript: "Second output" })));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount({ initialSessionId: "source-first" });
    await act(async () => {
      renderer.update(createElement(LiveRegionProvider, null, createElement(FlowExecutionsDialog, {
        open: true, onClose: vi.fn(), onOpenSession: vi.fn(), initialSessionId: "source-second",
      })));
    });
    await act(async () => resolveFirst(response({ ok: true, transcript: "Stale first output" })));
    expect(textOf(renderer.toJSON())).toContain("Second output");
    expect(textOf(renderer.toJSON())).not.toContain("Stale first output");
  });

  test("transcript failure offers Retry without pretending there is no output", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ ok: false, error: "Transcript unavailable" }, 503))
      .mockResolvedValueOnce(response({ ok: true, transcript: "Recovered output" })));
    const renderer = await mount({ initialSessionId: "executor-1" });
    expect(textOf(renderer.toJSON())).toContain("Couldn’t load transcript");
    expect(textOf(renderer.toJSON())).not.toContain("No transcript yet");
    await act(async () => buttons(renderer, "Retry")[0].props.onClick());
    expect(textOf(renderer.toJSON())).toContain("Recovered output");
  });

  test("double clicking Discuss makes one request and closing cancels navigation", async () => {
    const onOpenSession = vi.fn();
    let resolveDiscussion;
    const fetcher = vi.fn((url) => url === "/api/flows/discussion"
      ? new Promise((resolve) => { resolveDiscussion = resolve; })
      : Promise.resolve(response({ ok: true, transcript: "Run output" })));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount({ initialSessionId: "executor-1", onOpenSession });
    const discuss = buttons(renderer, "Discuss in Chat")[0].props.onClick;
    await act(async () => { discuss(); discuss(); });
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/flows/discussion")).toHaveLength(1);
    await act(async () => renderer.update(null));
    await act(async () => resolveDiscussion(response({ ok: true, sessionId: "discussion", familiarId: "sage" })));
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  test("Chat toolbar lazy-loads history and direct Flow viewers block sends without title inference", () => {
    const list = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
    const chat = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
    expect(list).toMatch(/lazy\(\(\) => import\(["'].*flow-executions-dialog/);
    expect(list).toContain("Flow runs");
    expect(chat).not.toMatch(/title\.startsWith\("Flow/);
    expect(chat).toMatch(/if \(flowBackedSession\) \{[\s\S]{0,240}return;/);
    expect(chat).toMatch(/!flowBackedSession && shouldShowDockedComposer/);
    expect(chat).toContain("Discuss in Chat");
    expect(chat).toContain("loadFlowSessionTranscript(sessionId)");
  });

  test("Flow runs lives in Session view options rather than adding another toolbar button", () => {
    const list = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
    const options = list.split('ariaLabel="Session view options"')[1]?.split("</OverflowMenu>")[0];
    expect(options?.includes("Flow runs")).toBe(true);
    expect(options).toMatch(/onSelect=\{\(\) => setFlowRunsOpen\(true\)\}/);
    expect(list.includes("onClick={() => setFlowRunsOpen(true)}")).toBe(false);
  });
});

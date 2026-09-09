// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// use-research-missions.test.tsx and right-chat-panel-behavior.test.tsx.
//
// The Research Desk half of "one run, many projections" (#4808): a run invoked
// from chat must be projectable BACK into the conversation that asked for it.
// This mounts the real mission detail and drives the affordance, because the
// interesting failure is not whether a button exists — it is whether it opens
// the originating conversation or the executor session the run itself spawned.
// Those are two different session ids on the same mission, and confusing them
// is invisible to any source-text assertion.
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./research-artifact-actions", () => ({
  ResearchArtifactActions: () => null,
  fetchResearchWorkspacePath: async () => null,
}));
vi.mock("./research-evidence-ledger", () => ({
  ResearchEvidenceLedger: () => null,
}));
vi.mock("@/components/flow-executions-dialog", () => ({
  FlowExecutionsDialog: ({ initialSessionId }) => createElement("div", {
    "data-transcript-session": initialSessionId,
  }, "Read-only Flow transcript"),
}));

import { LiveRegionProvider } from "@/components/ui/live-region";
import { ResearchMissionDetail } from "./research-mission-detail";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The executor session the RUN spawned — deliberately different from the
 *  conversation the run was invoked from, so a mix-up cannot pass. */
const EXECUTOR_SESSION_ID = "executor-session-9";
const ORIGIN_SESSION_ID = "conversation-1";

function mission(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "mission-1",
    familiarId: "familiar-a",
    title: "Vector store comparison",
    intent: "Compare managed vector stores for a small team",
    mode: "brief",
    modeSource: "auto",
    deliverable: "Brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 30,
      maxIterations: 3,
      sourceTarget: 5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    },
    status: "running",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    iterations: [{ number: 1, status: "running", sessionId: EXECUTOR_SESSION_ID }],
    artifacts: [],
    sources: [],
    ...overrides,
  };
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "children" in (node as Record<string, unknown>)) {
    return textOf((node as { children: unknown }).children);
  }
  return "";
}

async function mount(missionValue: Record<string, unknown>, onOpenSession: (id: string) => void, showEvidence = false) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(
      LiveRegionProvider,
      null,
      createElement(ResearchMissionDetail, {
        mission: missionValue,
        showEvidence,
        onOpenSession,
        onOpenUrl: () => {},
        onShowResources: () => {},
        onAction: async () => ({ ok: true }),
        onSchedule: async () => ({ ok: true }),
        onAutomationAction: async () => ({ ok: true }),
      }),
    ));
  });
  return renderer;
}

function buttonsLabelled(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .filter((button) => textOf(button.props.children).includes(label));
}

describe("Research Desk projects a chat-invoked run back into its conversation", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("the origin jump opens the conversation, not the executor session", async () => {
    const opened: string[] = [];
    const renderer = await mount(
      mission({ origin: { surface: "chat", sessionId: ORIGIN_SESSION_ID } }),
      (id) => opened.push(id),
    );

    const originButtons = buttonsLabelled(renderer, "Open the chat that started this");
    expect(originButtons).toHaveLength(1);
    await act(async () => {
      originButtons[0].props.onClick();
    });
    // The whole point: the conversation, never the run's own executor session.
    expect(opened).toEqual([ORIGIN_SESSION_ID]);

    // The executor session stays separately reachable — the two affordances are
    // different destinations, not a rename of one.
    const sessionButtons = buttonsLabelled(renderer, "View transcript");
    expect(sessionButtons).toHaveLength(1);
    await act(async () => {
      sessionButtons[0].props.onClick();
    });
    expect(opened).toEqual([ORIGIN_SESSION_ID]);
    expect(renderer.root.findByProps({ "data-transcript-session": EXECUTOR_SESSION_ID })).toBeTruthy();
    await act(async () => renderer.unmount());
  });

  test("a run with no chat to return to offers no jump back", async () => {
    // A desk-invoked run and a legacy run both have nowhere to go; offering the
    // jump anyway would open some unrelated conversation.
    for (const value of [mission({ origin: { surface: "research-desk" } }), mission()]) {
      const opened: string[] = [];
      const renderer = await mount(value, (id) => opened.push(id));
      expect(buttonsLabelled(renderer, "Open the chat that started this")).toHaveLength(0);
      expect(buttonsLabelled(renderer, "View transcript")).toHaveLength(1);
      await act(async () => renderer.unmount());
    }
  });

  test("the run says which surface invoked it", async () => {
    const renderer = await mount(
      mission({ origin: { surface: "chat", sessionId: ORIGIN_SESSION_ID } }),
      () => {},
    );
    expect(textOf(renderer.toJSON())).toContain("Started from chat");
    await act(async () => renderer.unmount());

    const deskRenderer = await mount(mission({ origin: { surface: "research-desk" } }), () => {});
    expect(textOf(deskRenderer.toJSON())).toContain("Started from the Research Desk");
    await act(async () => deskRenderer.unmount());
  });

  test("the evidence-rail discussion creates a separate chat for the returned owner", async () => {
    const onOpenSession = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true, sessionId: "new-discussion", familiarId: "actual-owner",
    })));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await mount(mission(), onOpenSession, true);
    const button = renderer.root.findAllByType("button").find((node) => textOf(node).includes("Discuss this run in chat"));
    await act(async () => button.props.onClick());
    expect(fetcher).toHaveBeenCalledWith("/api/flows/discussion", expect.objectContaining({
      body: JSON.stringify({ sessionId: EXECUTOR_SESSION_ID }),
    }));
    expect(onOpenSession).toHaveBeenCalledExactlyOnceWith("new-discussion", "actual-owner");
    await act(async () => renderer.unmount());
  });

  test("the evidence-rail discussion failure is actionable without navigating", async () => {
    const onOpenSession = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false, error: "Retry when the familiar is available",
    }), { status: 503 })));
    const renderer = await mount(mission(), onOpenSession, true);
    const button = renderer.root.findAllByType("button").find((node) => textOf(node).includes("Discuss this run in chat"));
    await act(async () => button.props.onClick());
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(textOf(renderer.toJSON())).toContain("Retry when the familiar is available");
    await act(async () => renderer.unmount());
  });
});

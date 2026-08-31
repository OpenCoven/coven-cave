// @ts-nocheck — react-test-renderer ships no types; this is a rendered production integration test.
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

import { LiveRegionProvider } from "@/components/ui/live-region";
import type { ResearchMission } from "@/lib/research-missions";
import type {
  ResearchRunV1,
  RunEventV1,
} from "@/lib/research-protocol/research-run";
import { ResearchMissionDetail } from "./research-mission-detail";
import { useResearchRunGateway } from "./use-research-run-gateway";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RUN_ID = "run_mission-1";
const UPDATED_AT = "2026-08-31T17:00:00.000Z";

function mission(overrides: Partial<ResearchMission> = {}): ResearchMission {
  return {
    version: 1,
    id: "mission-1",
    familiarId: "sage",
    title: "Canonical projection integration",
    intent: "Show the Research Run projections in the Desk",
    mode: "brief",
    modeSource: "user",
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
    createdAt: "2026-08-31T16:00:00.000Z",
    updatedAt: UPDATED_AT,
    iterations: [{
      number: 1,
      status: "running",
      startedAt: "2026-08-31T16:05:00.000Z",
      steps: [{
        id: "legacy-scope",
        type: "legacy scope",
        status: "running",
        detail: "Persisted mission fallback",
      }],
    }],
    artifacts: [],
    sources: [],
    ...overrides,
  };
}

function run(
  id = RUN_ID,
  overrides: Partial<ResearchRunV1> = {},
): ResearchRunV1 {
  return {
    schema: "opencoven.research-run/v1",
    id,
    acceptedTopic: {
      question: "Which evidence supports the launch?",
      editedByUser: false,
    },
    execution: {
      location: "local",
      modelExecution: "cave-device",
      modelBinding: {
        familiarId: "sage",
        selection: "pinned",
        model: "research-model",
      },
      strategy: "single-agent",
    },
    privacy: {
      remoteQueries: false,
      remoteContent: false,
      artifactContentSync: false,
      retention: "7-days",
      allowMemoryPromotion: false,
    },
    bounds: mission().bounds,
    status: "completed",
    createdAt: "2026-08-31T16:00:00.000Z",
    updatedAt: UPDATED_AT,
    nextEventSequence: 7,
    ...overrides,
  };
}

function event(
  sequence: number,
  type: RunEventV1["type"],
  data: Record<string, unknown>,
  runId = RUN_ID,
): RunEventV1 {
  return {
    schema: "opencoven.run-event/v1",
    runId,
    sequence,
    type,
    at: `2026-08-31T16:0${sequence}:00.000Z`,
    data,
  };
}

function canonicalEvents(runId = RUN_ID): RunEventV1[] {
  return [
    event(1, "run.created", {
      activity: "Canonical launch",
      plan: {
        revision: 1,
        label: "Original plan",
        stages: [
          { id: "scope", label: "Frame the question", status: "completed" },
        ],
      },
    }, runId),
    event(2, "phase.started", {
      phase: "challenge",
      activity: "Testing canonical evidence",
      plan: {
        revision: 2,
        label: "Revised plan",
        reason: "A conflicting source needs another pass.",
        stages: [
          { id: "scope", label: "Frame the question", status: "completed" },
          { id: "verify", label: "Verify citations", status: "active" },
        ],
      },
    }, runId),
    event(3, "phase.completed", {
      phase: "challenge",
      sources: 2,
      reviewed: 2,
      retained: 1,
      rejected: 1,
      cited: 1,
      evidence: {
        sources: [{
          id: "source-1",
          title: "Canonical source",
          status: "used",
          sourceType: "web",
          url: "https://example.test/source",
        }],
        claims: [{
          id: "claim-1",
          text: "The launch is reversible.",
          sourceIds: ["source-1"],
          status: "supported",
        }],
      },
    }, runId),
    event(4, "artifact.registered", {
      artifact: {
        id: "report-1",
        title: "Launch report",
        kind: "report",
        status: "published",
      },
      report: {
        outline: [{
          id: "overview",
          title: "Canonical overview",
          status: "complete",
          depth: 0,
        }],
        artifacts: [{
          id: "report-1",
          title: "Launch report",
          kind: "report",
          status: "published",
        }],
        exportStatus: "ready",
      },
    }, runId),
    event(5, "run.status", {
      status: "publishing",
      report: {
        export: {
          status: "exported",
          detail: "Markdown bundle",
          at: UPDATED_AT,
        },
      },
    }, runId),
    event(6, "run.status", { status: "completed" }, runId),
  ];
}

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Listener[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: Listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  emit(name: string, value: unknown) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data: JSON.stringify(value) });
    }
  }

  close() {
    this.closed = true;
  }
}

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "children" in (node as Record<string, unknown>)) {
    return textOf((node as { children: unknown }).children);
  }
  return "";
}

function Harness({
  missionValue,
  selector = missionValue.id,
}: {
  missionValue: ResearchMission;
  selector?: string;
}) {
  const gateway = useResearchRunGateway(selector, missionValue.familiarId, missionValue);
  return createElement(
    LiveRegionProvider,
    null,
    createElement(ResearchMissionDetail, {
      mission: missionValue,
      canonicalRun: gateway.eventState,
      runProjections: gateway.projections,
      runProjectionSource: gateway.projectionSource,
      runGatewayStatus: gateway.status,
      runGatewayError: gateway.error ?? gateway.projectionError,
      showEvidence: false,
      onOpenSession: () => {},
      onOpenUrl: () => {},
      onShowResources: () => {},
      onAction: async () => ({ ok: true }),
      onSchedule: async () => ({ ok: true }),
      onAutomationAction: async () => ({ ok: true }),
    }),
  );
}

async function mount(missionValue = mission(), selector = missionValue.id) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Harness, { missionValue, selector }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe("Research Desk canonical projection integration", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders canonical plan, activity, evidence, and report only after complete replay", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        ok: true,
        run: run(),
        lastEventSequence: 6,
        nextEventSequence: 7,
      }),
    })));
    const renderer = await mount();
    const source = FakeEventSource.instances[0];

    expect(source).toBeDefined();
    expect(textOf(renderer.toJSON())).toContain(
      "Loading canonical run history. Showing persisted mission data.",
    );
    expect(textOf(renderer.toJSON())).toContain("Persisted mission fallback");

    await act(async () => {
      source.emit("snapshot", {
        run: run(),
        lastEventSequence: 6,
        nextEventSequence: 7,
        afterSeq: 0,
      });
      for (const item of canonicalEvents()) source.emit("run-event", item);
    });

    const rendered = textOf(renderer.toJSON());
    expect(rendered).toContain("Original plan");
    expect(rendered).toContain("Revised plan");
    expect(rendered).toContain("Verify citations");
    expect(rendered).toContain("Canonical launch");
    expect(rendered).toContain("Testing canonical evidence");
    expect(rendered).toContain("The launch is reversible.");
    expect(rendered).toContain("Canonical overview");
    expect(rendered).toContain("Launch report");
    expect(rendered).toContain("Exported · Markdown bundle");
    expect(rendered).not.toContain("Persisted mission fallback");

    const plan = renderer.root.findByProps({ "data-research-run-projection": "plan" });
    expect(textOf(plan)).not.toContain(" active");
    expect(plan.props["data-active-stage"]).toBeUndefined();

    await act(async () => {
      source.onerror?.();
    });
    expect(textOf(renderer.toJSON())).toContain(
      "Reconnecting to live updates. Showing the last complete canonical history.",
    );
    expect(textOf(renderer.toJSON())).toContain("Canonical overview");

    await act(async () => renderer.unmount());
  });

  test("drops the prior generation before replaying a replacement generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        ok: true,
        run: run(),
        lastEventSequence: 6,
        nextEventSequence: 7,
      }),
    })));
    const renderer = await mount();
    const source = FakeEventSource.instances[0];
    await act(async () => {
      source.emit("snapshot", {
        run: run(),
        lastEventSequence: 6,
        nextEventSequence: 7,
        afterSeq: 0,
      });
      for (const item of canonicalEvents()) source.emit("run-event", item);
    });
    expect(textOf(renderer.toJSON())).toContain("Canonical launch");

    const nextRunId = "run_mission-1_g2";
    const nextRun = run(nextRunId, {
      status: "scoping",
      nextEventSequence: 2,
      updatedAt: "2026-08-31T18:00:00.000Z",
    });
    await act(async () => {
      source.emit("snapshot", {
        run: nextRun,
        lastEventSequence: 1,
        nextEventSequence: 2,
        afterSeq: 0,
      });
    });
    expect(textOf(renderer.toJSON())).not.toContain("Canonical launch");
    expect(textOf(renderer.toJSON())).toContain("Persisted mission fallback");

    await act(async () => {
      source.emit("run-event", event(1, "run.created", {
        activity: "Generation two launch",
        plan: {
          revision: 1,
          stages: [{ id: "scope", label: "Generation two scope", status: "active" }],
        },
      }, nextRunId));
    });
    expect(textOf(renderer.toJSON())).toContain("Generation two launch");
    expect(textOf(renderer.toJSON())).toContain("Generation two scope");
    expect(textOf(renderer.toJSON())).not.toContain("Canonical launch");

    await act(async () => renderer.unmount());
  });

  test("keeps the mission adapter as an explicit fallback when the gateway is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ ok: false, error: "research run not found" }),
    })));
    const renderer = await mount();
    const rendered = textOf(renderer.toJSON());

    expect(rendered).toContain(
      "Couldn't load canonical run history. Showing persisted mission data.",
    );
    expect(rendered).toContain("Persisted mission fallback");
    expect(FakeEventSource.instances).toHaveLength(0);

    await act(async () => renderer.unmount());
  });

  test("an exact historical terminal run never absorbs artifacts from a later mission generation", async () => {
    const currentMission = mission({
      runGeneration: 2,
      artifacts: [{
        key: "future-report",
        kind: "report",
        title: "Later generation report",
        relativePath: "artifacts/later.md",
        iteration: 2,
        state: "published",
        updatedAt: "2026-08-31T19:00:00.000Z",
      }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        ok: true,
        run: run(),
        lastEventSequence: 6,
        nextEventSequence: 7,
      }),
    })));
    const renderer = await mount(currentMission, RUN_ID);
    const source = FakeEventSource.instances[0];

    await act(async () => {
      source.emit("snapshot", {
        run: run(),
        lastEventSequence: 6,
        nextEventSequence: 7,
        afterSeq: 0,
      });
      for (const item of canonicalEvents()) source.emit("run-event", item);
    });

    expect(textOf(renderer.toJSON())).toContain("Launch report");
    expect(textOf(renderer.toJSON())).not.toContain("Later generation report");

    await act(async () => renderer.unmount());
  });
});

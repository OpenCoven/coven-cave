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

function terminalManifest(runId = RUN_ID): NonNullable<ResearchRunV1["artifactManifest"]> {
  return {
    schema: "opencoven.run-manifest/v1",
    id: `manifest_${runId}`,
    runId,
    digest: "a".repeat(64),
    revision: 1,
    state: "final",
    createdAt: "2026-08-31T16:00:00.000Z",
    finalizedAt: UPDATED_AT,
    sources: [],
    artifacts: [],
    modelExecutions: [],
    usage: {
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      completeness: "unreported",
    },
    retention: {
      policy: "7-days",
      effectivePolicy: "7-days",
      status: "active",
      contentExpiresAt: null,
      updatedAt: UPDATED_AT,
    },
    deletion: { status: "not_scheduled" },
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

function productionGatewayEvents(runId = RUN_ID): RunEventV1[] {
  return [
    event(1, "run.created", {}, runId),
    event(2, "run.completed", {
      status: "completed",
      sources: 1,
      artifacts: 1,
      iterations: 1,
    }, runId),
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
      onRetryRunGateway: gateway.retry,
      missionDetailAvailable: gateway.missionDetailAvailable,
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

  test("hybrid projections retain mission detail while real gateway chronology and terminal evidence win", async () => {
    const detailedMission = mission({
      status: "completed",
      iterations: [{
        number: 1,
        status: "completed",
        startedAt: "2026-08-31T16:05:00.000Z",
        finishedAt: UPDATED_AT,
        summary: "Persisted report detail",
        steps: [{
          id: "scope",
          type: "scope",
          status: "running",
          detail: "Persisted plan detail",
        }],
      }],
      sources: [{
        id: "source-1",
        title: "Persisted source detail",
        sourceType: "web",
        status: "used",
        claim: "Persisted evidence claim",
      }],
      artifacts: [{
        key: "report-1",
        kind: "report",
        title: "Persisted report artifact",
        relativePath: "artifacts/report.md",
        iteration: 1,
        state: "published",
        knowledgeId: "knowledge-report-1",
        updatedAt: UPDATED_AT,
      }],
    });
    const terminalRun = run(RUN_ID, {
      nextEventSequence: 3,
      artifactManifest: terminalManifest(),
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        ok: true,
        run: terminalRun,
        lastEventSequence: 2,
        nextEventSequence: 3,
      }),
    })));
    const renderer = await mount(detailedMission);
    const source = FakeEventSource.instances[0];

    expect(source).toBeDefined();
    expect(textOf(renderer.toJSON())).toContain(
      "Loading canonical run history. Showing persisted mission data.",
    );
    expect(textOf(renderer.toJSON())).toContain("Persisted plan detail");

    await act(async () => {
      source.emit("snapshot", {
        run: terminalRun,
        lastEventSequence: 2,
        nextEventSequence: 3,
        afterSeq: 0,
      });
      for (const item of productionGatewayEvents()) source.emit("run-event", item);
    });

    const rendered = textOf(renderer.toJSON());
    expect(rendered).toContain("Persisted plan detail");
    expect(rendered).toContain("Run Created");
    expect(rendered).toContain("Run completed");
    expect(rendered).not.toContain("Run status: Completed");
    expect(rendered).toContain("Persisted evidence claim");
    expect(rendered).toContain("Persisted report detail");
    expect(rendered).toContain("Persisted report artifact");
    expect(rendered).toContain("Export ready");
    expect(rendered).not.toContain("Exported");

    const plan = renderer.root.findByProps({ "data-research-run-projection": "plan" });
    expect(textOf(plan)).not.toContain(" active");
    expect(plan.props["data-active-stage"]).toBeUndefined();

    await act(async () => {
      source.onerror?.();
    });
    expect(textOf(renderer.toJSON())).toContain(
      "Reconnecting to live updates. Showing the last complete canonical history.",
    );
    expect(textOf(renderer.toJSON())).toContain("Persisted report detail");

    await act(async () => renderer.unmount());
  });

  test("sparse production history keeps working artifacts in draft export state", async () => {
    const workingMission = mission({
      artifacts: [{
        key: "report-working",
        kind: "report",
        title: "Working report",
        relativePath: "artifacts/working.md",
        iteration: 1,
        state: "working",
        updatedAt: UPDATED_AT,
      }, {
        key: "report-rejected",
        kind: "report",
        title: "Rejected report",
        relativePath: "artifacts/rejected.md",
        iteration: 1,
        state: "rejected",
        updatedAt: UPDATED_AT,
      }],
    });
    const sparseRun = run(RUN_ID, {
      status: "gathering_public_sources",
      nextEventSequence: 3,
      artifactManifest: undefined,
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        ok: true,
        run: sparseRun,
        lastEventSequence: 2,
        nextEventSequence: 3,
      }),
    })));
    const renderer = await mount(workingMission);
    const source = FakeEventSource.instances[0];

    await act(async () => {
      source.emit("snapshot", {
        run: sparseRun,
        lastEventSequence: 2,
        nextEventSequence: 3,
        afterSeq: 0,
      });
      source.emit("run-event", event(1, "run.created", {}));
      source.emit("run-event", event(2, "run.status", {
        status: "gathering_public_sources",
        sources: 0,
        artifacts: 2,
        iterations: 1,
      }));
    });

    const rendered = textOf(renderer.toJSON());
    expect(rendered).toContain("Working report");
    expect(rendered).toContain("Rejected report");
    expect(rendered).toContain("Export draft");
    expect(rendered).not.toContain("Export ready");

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
    expect(textOf(renderer.toJSON())).toContain("Loading historical run history.");
    expect(textOf(renderer.toJSON())).not.toContain("Persisted mission fallback");

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

    expect(rendered).toContain("Couldn't load canonical run history");
    expect(rendered).toContain("Showing persisted mission data.");
    expect(rendered).toContain("Persisted mission fallback");
    expect(FakeEventSource.instances).toHaveLength(0);

    await act(async () => renderer.unmount());
  });

  test("initial gateway failure retries once and hydrates one fresh event stream", async () => {
    let resolveRetry!: (response: { json(): Promise<unknown> }) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ ok: false, error: "research run unavailable" }),
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRetry = resolve;
      }));
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await mount();

    const retry = renderer.root.findAllByType("button")
      .find((button) => textOf(button) === "Retry");
    expect(retry).toBeDefined();
    expect(FakeEventSource.instances).toHaveLength(0);

    await act(async () => {
      retry!.props.onClick();
      retry!.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renderer.root.findAllByType("button")
      .some((button) => textOf(button) === "Retry")).toBe(false);
    expect(textOf(renderer.toJSON())).toContain(
      "Loading canonical run history. Showing persisted mission data.",
    );
    expect(FakeEventSource.instances).toHaveLength(0);

    await act(async () => {
      resolveRetry({
        json: async () => ({
          ok: true,
          run: run(RUN_ID, { nextEventSequence: 2 }),
          lastEventSequence: 1,
          nextEventSequence: 2,
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];
    await act(async () => {
      source.emit("snapshot", {
        run: run(RUN_ID, { nextEventSequence: 2 }),
        lastEventSequence: 1,
        nextEventSequence: 2,
        afterSeq: 0,
      });
      source.emit("run-event", event(1, "run.created", {}));
    });

    expect(textOf(renderer.toJSON())).toContain("Run Created");
    expect(textOf(renderer.toJSON())).not.toContain("Couldn't load canonical run history");

    await act(async () => renderer.unmount());
    expect(source.closed).toBe(true);
  });

  test("retry closes the failed stream and ignores its stale callbacks", async () => {
    const replayRun = run(RUN_ID, { nextEventSequence: 2 });
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        ok: true,
        run: replayRun,
        lastEventSequence: 1,
        nextEventSequence: 2,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await mount();
    const staleSource = FakeEventSource.instances[0];

    await act(async () => {
      staleSource.emit("snapshot", { invalid: true });
    });
    expect(staleSource.closed).toBe(true);
    const retry = renderer.root.findAllByType("button")
      .find((button) => textOf(button) === "Retry");
    expect(retry).toBeDefined();

    await act(async () => {
      retry!.props.onClick();
      retry!.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeEventSource.instances).toHaveLength(2);
    const currentSource = FakeEventSource.instances[1];
    await act(async () => {
      staleSource.emit("snapshot", {
        run: replayRun,
        lastEventSequence: 1,
        nextEventSequence: 2,
        afterSeq: 0,
      });
      staleSource.emit("run-event", event(1, "run.created", {
        activity: "Stale generation activity",
      }));
      currentSource.emit("snapshot", {
        run: replayRun,
        lastEventSequence: 1,
        nextEventSequence: 2,
        afterSeq: 0,
      });
      currentSource.emit("run-event", event(1, "run.created", {}));
    });

    const rendered = textOf(renderer.toJSON());
    expect(rendered).toContain("Run Created");
    expect(rendered).not.toContain("Stale generation activity");

    await act(async () => renderer.unmount());
    expect(currentSource.closed).toBe(true);
  });

  test("an exact historical run never exposes the current generation during loading, error, or replay", async () => {
    const currentMission = mission({
      runGeneration: 2,
      title: "Generation two mission",
      intent: "Generation two intent",
      lastError: "Generation two failure",
      sources: [{
        id: "future-source",
        title: "Generation two evidence",
        sourceType: "web",
        status: "used",
      }],
      iterations: [{
        number: 2,
        status: "running",
        startedAt: "2026-08-31T19:00:00.000Z",
        steps: [{
          id: "future-plan",
          type: "future plan",
          status: "running",
          detail: "Generation two plan",
        }],
      }],
      artifacts: [{
        key: "future-report",
        kind: "report",
        title: "Generation two report",
        relativePath: "artifacts/later.md",
        iteration: 2,
        state: "published",
        updatedAt: "2026-08-31T19:00:00.000Z",
      }],
    });
    let resolveInitial!: (response: { json(): Promise<unknown> }) => void;
    let resolveRetry!: (response: { json(): Promise<unknown> }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveInitial = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRetry = resolve;
      }));
    vi.stubGlobal("fetch", fetchMock);
    const renderer = await mount(currentMission, RUN_ID);
    const assertNoCurrentGeneration = () => {
      const rendered = textOf(renderer.toJSON());
      expect(rendered).not.toContain("Generation two mission");
      expect(rendered).not.toContain("Generation two intent");
      expect(rendered).not.toContain("Generation two failure");
      expect(rendered).not.toContain("Generation two plan");
      expect(rendered).not.toContain("Generation two evidence");
      expect(rendered).not.toContain("Generation two report");
      expect(rendered).not.toContain("Cancel run");
    };

    await act(async () => {
      await Promise.resolve();
    });
    expect(textOf(renderer.toJSON())).toContain("Historical research run");
    expect(textOf(renderer.toJSON())).toContain("Loading historical run history.");
    assertNoCurrentGeneration();

    await act(async () => {
      resolveInitial({
        json: async () => ({ ok: false, error: "historical run unavailable" }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textOf(renderer.toJSON())).toContain("Couldn't load historical run");
    assertNoCurrentGeneration();

    const retry = renderer.root.findAllByType("button")
      .find((button) => textOf(button) === "Retry");
    expect(retry).toBeDefined();
    await act(async () => {
      retry!.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveRetry({
        json: async () => ({
          ok: true,
          run: run(),
          lastEventSequence: 6,
          nextEventSequence: 7,
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
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

    expect(textOf(renderer.toJSON())).toContain("Which evidence supports the launch?");
    expect(textOf(renderer.toJSON())).toContain("Canonical launch");
    expect(textOf(renderer.toJSON())).toContain("Launch report");
    assertNoCurrentGeneration();

    await act(async () => renderer.unmount());
  });
});

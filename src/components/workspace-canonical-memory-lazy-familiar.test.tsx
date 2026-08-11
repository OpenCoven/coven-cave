// @ts-nocheck
import { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { FamiliarsView } from "./familiars-view";
import * as canonicalMemory from "@/lib/canonical-memory";

const captured = vi.hoisted(() => ({
  overlays: [] as Array<{
    familiarId: string;
    pendingId: string | null;
  }>,
  emptyRosterRenders: 0,
}));

vi.mock("@/lib/canonical-memory-resources", () => ({
  loadCanonicalMemoryList: async () => ({ state: "ready", entries: [] }),
  loadCanonicalMemoryOverview: async () => ({
    state: "error",
    error: new Error("not needed"),
  }),
  refreshCanonicalMemory: async () => ({
    list: { state: "ready", entries: [] },
    overview: { state: "error", error: new Error("not needed") },
  }),
}));
vi.mock("@/lib/surface-warmup-registry", () => ({
  readSurfaceResource: async () => ({
    data: { ok: true, entries: [] },
  }),
}));
vi.mock("@/lib/use-pausable-poll", () => ({
  usePausablePoll: () => {},
}));
vi.mock("@/lib/datetime-format", () => ({
  useDateTimePrefs: () => {},
}));
vi.mock("@/lib/familiar-resolve", () => ({
  useResolvedFamiliars: (familiars: unknown[]) => familiars,
}));
vi.mock("@/lib/surface-preferences", async () => {
  const { useState } = await import("react");
  return {
    useSurfacePreference: (spec: { defaultValue: unknown }) =>
      useState(spec.defaultValue),
  };
});
vi.mock("@/lib/summon-events", () => ({
  SUMMON_FAMILIAR_EVENT: "test:summon",
  hasSummonPending: () => false,
  consumeSummonPending: () => false,
}));
vi.mock("@/lib/icon", () => ({
  Icon: () => null,
}));
vi.mock("@/components/familiar-summoning-circle", () => ({
  FamiliarSummoningCircle: () => null,
}));
vi.mock("@/components/familiars-view-stats", () => ({
  buildFamiliarCardStats: () => new Map(),
}));
vi.mock("@/components/familiars-view-sections", () => ({
  emptyStats: () => ({}),
  FamiliarsEmptyState: () => {
    captured.emptyRosterRenders += 1;
    return <div data-testid="empty-roster" />;
  },
  FamiliarRosterCard: () => null,
  FamiliarDetailRail: () => null,
  FamiliarDetailPanel: () => null,
  FamiliarAvatarPreviewOverlay: () => null,
  FamiliarMemoryOverlay: (props: {
    familiar: { id: string };
    pendingCanonicalMemorySelection?: { id: string } | null;
  }) => {
    captured.overlays.push({
      familiarId: props.familiar.id,
      pendingId: props.pendingCanonicalMemorySelection?.id ?? null,
    });
    return null;
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const target = {
  id: "salem",
  display_name: "Salem",
  role: "familiar",
};
const other = {
  id: "charm",
  display_name: "Charm",
  role: "familiar",
};
const pending = {
  id: "018f0f77-2f49-7c18-9e52-437b312f8a60",
  familiarId: target.id,
};
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type RosterResponse =
  | { ok: true; familiars: Array<typeof target> }
  | { ok: false; error?: string };

type RosterRaceState = {
  familiars: Array<typeof target>;
  pending: typeof pending | null;
  settled: typeof pending | null;
  error: string | null;
  loaded: boolean;
  loadedSuccessfully: boolean;
};

function startRosterRequest(
  state: RosterRaceState,
  generation: { current: number },
  response: Promise<RosterResponse>,
  isLatest: (requestGeneration: number, latestGeneration: number) => boolean,
) {
  const requestGeneration = ++generation.current;
  const pendingSelectionAtStart = state.pending;
  return (async () => {
    try {
      const json = await response;
      if (!isLatest(requestGeneration, generation.current)) return;
      if (!json.ok) {
        state.error = json.error ?? "daemon offline";
        state.loadedSuccessfully = false;
        state.settled =
          canonicalMemory.reconcilePendingCanonicalRosterSettlement({
            settled: state.settled,
            current: state.pending,
            startedFor: pendingSelectionAtStart,
            succeeded: false,
          });
        return;
      }
      state.error = null;
      state.familiars = json.familiars;
      state.loadedSuccessfully = true;
      state.settled =
        canonicalMemory.reconcilePendingCanonicalRosterSettlement({
          settled: state.settled,
          current: state.pending,
          startedFor: pendingSelectionAtStart,
          succeeded: true,
        });
    } catch (error) {
      if (!isLatest(requestGeneration, generation.current)) return;
      state.error = error instanceof Error ? error.message : "fetch failed";
      state.loadedSuccessfully = false;
      state.settled =
        canonicalMemory.reconcilePendingCanonicalRosterSettlement({
          settled: state.settled,
          current: state.pending,
          startedFor: pendingSelectionAtStart,
          succeeded: false,
        });
    } finally {
      if (isLatest(requestGeneration, generation.current)) {
        state.loaded = true;
      }
    }
  })();
}

function rosterRaceView(
  state: RosterRaceState,
  onUnavailable: (selection: typeof pending) => void,
) {
  return view(state.familiars, {
    priorRosterLoadedSuccessfully: state.loadedSuccessfully,
    pendingRosterSettledSuccessfully:
      state.pending !== null && state.settled === state.pending,
    selection: state.pending,
    onUnavailable,
    familiarsError: state.error,
  });
}

function view(
  familiars: typeof target[],
  options: {
    priorRosterLoadedSuccessfully?: boolean;
    pendingRosterSettledSuccessfully?: boolean;
    selection?: typeof pending | null;
    onUnavailable?: (selection: typeof pending) => void;
    onApplied?: (id: string) => void;
    familiarsError?: string | null;
  } = {},
) {
  const selection =
    options.selection === undefined ? pending : options.selection;
  return (
    <FamiliarsView
      familiars={familiars}
      sessions={[]}
      activeFamiliar={other}
      daemonRunning
      localDaemonReady
      responseNeeded={new Set()}
      onStartChat={() => {}}
      onOpenSession={() => {}}
      onOpenMemoryFile={() => {}}
      onOpenOnboarding={() => {}}
      onOpenUrl={() => {}}
      familiarRosterLoadedSuccessfully={
        options.priorRosterLoadedSuccessfully ?? false
      }
      pendingRosterSettledSuccessfully={
        options.pendingRosterSettledSuccessfully ?? false
      }
      pendingCanonicalMemorySelection={selection}
      onCanonicalMemorySelectionApplied={options.onApplied ?? (() => {})}
      onCanonicalMemorySelectionUnavailable={
        options.onUnavailable ?? (() => {})
      }
      familiarsError={options.familiarsError}
    />
  );
}

function SettledMissingRosterParent({
  pendingRosterSettledSuccessfully,
  onUnavailable,
  onApplied,
}: {
  pendingRosterSettledSuccessfully: boolean;
  onUnavailable: (selection: typeof pending) => void;
  onApplied: (id: string) => void;
}) {
  const [selection, setSelection] = useState<typeof pending | null>(pending);
  return (
    <>
      <span data-testid="parent-pending">
        {selection?.id ?? "cleared"}
      </span>
      {view([], {
        priorRosterLoadedSuccessfully: true,
        pendingRosterSettledSuccessfully,
        selection,
        onUnavailable: (expected) => {
        onUnavailable(expected);
        setSelection((current) =>
            canonicalMemory.rejectPendingCanonicalMemorySelection(
              current,
              expected,
            )
          );
        },
        onApplied,
      })}
    </>
  );
}

beforeEach(() => {
  captured.overlays = [];
  captured.emptyRosterRenders = 0;
  globalThis.window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Document;
});

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  vi.restoreAllMocks();
});

describe("lazy FamiliarsView canonical target", () => {
  test("a prior successful snapshot missing the target cannot reject while the pending selection's request is unresolved", async () => {
    const unavailable: Array<typeof pending> = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        view([other], {
          selection: null,
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      renderer.update(
        view([other], {
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });

    expect(unavailable).toEqual([]);
    expect(captured.overlays).toEqual([]);
    await act(async () => renderer.unmount());
  });

  test("a fresh request that succeeds with the target mounts and applies the exact pending overlay without rejecting", async () => {
    const unavailable: Array<typeof pending> = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        view([other], {
          selection: null,
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(
        view([other], {
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(
        view([target], {
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: true,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });

    expect(unavailable).toEqual([]);
    expect(captured.overlays.at(-1)).toEqual({
      familiarId: target.id,
      pendingId: pending.id,
    });

    await act(async () => renderer.unmount());
  });

  test("a fresh request that succeeds still missing the target rejects that exact pending selection once", async () => {
    const unavailable: Array<typeof pending> = [];
    const applied: string[] = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <SettledMissingRosterParent
          pendingRosterSettledSuccessfully={false}
          onUnavailable={(selection) => unavailable.push(selection)}
          onApplied={(id) => applied.push(id)}
        />,
      );
      await Promise.resolve();
    });
    expect(unavailable).toEqual([]);
    expect(
      renderer.root.findByProps({ "data-testid": "parent-pending" }).children,
    ).toEqual([pending.id]);

    await act(async () => {
      renderer.update(
        <SettledMissingRosterParent
          pendingRosterSettledSuccessfully
          onUnavailable={(selection) => unavailable.push(selection)}
          onApplied={(id) => applied.push(id)}
        />,
      );
      await Promise.resolve();
    });
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]).toBe(pending);
    expect(applied).toEqual([]);
    expect(captured.overlays).toEqual([]);
    expect(
      renderer.root.findByProps({ "data-testid": "parent-pending" }).children,
    ).toEqual(["cleared"]);

    await act(async () => {
      renderer.update(
        <SettledMissingRosterParent
          pendingRosterSettledSuccessfully
          onUnavailable={(selection) => unavailable.push(selection)}
          onApplied={(id) => applied.push(id)}
        />,
      );
      await Promise.resolve();
    });
    expect(unavailable).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  test("a missing response from a request started before the pending selection cannot authorize rejection", async () => {
    const unavailable: Array<typeof pending> = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        view([other], {
          selection: null,
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(
        view([other], {
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(
        view([{ ...other }], {
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });

    expect(unavailable).toEqual([]);
    expect(captured.overlays).toEqual([]);
    await act(async () => renderer.unmount());
  });

  test("a fresh request failure keeps waiting and never rejects from the prior successful snapshot", async () => {
    const unavailable: Array<typeof pending> = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        view([other], {
          selection: null,
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(
        view([other], {
          priorRosterLoadedSuccessfully: true,
          pendingRosterSettledSuccessfully: false,
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(
        view([other], {
          priorRosterLoadedSuccessfully: false,
          pendingRosterSettledSuccessfully: false,
          familiarsError: "transient roster failure",
          onUnavailable: (selection) => unavailable.push(selection),
        }),
      );
      await Promise.resolve();
    });

    expect(unavailable).toEqual([]);
    expect(captured.overlays).toEqual([]);
    await act(async () => renderer.unmount());
  });

  test("a newer target response wins before an older missing response and remains mounted", async () => {
    const isLatest = canonicalMemory.isLatestFamiliarRosterRequest;
    expect(isLatest).toBeTypeOf("function");

    const generation = { current: 0 };
    const older = deferred<RosterResponse>();
    const newer = deferred<RosterResponse>();
    const state: RosterRaceState = {
      familiars: [other],
      pending: null,
      settled: null,
      error: "prior error",
      loaded: false,
      loadedSuccessfully: false,
    };
    const unavailable: Array<typeof pending> = [];
    const olderRequest = startRosterRequest(
      state,
      generation,
      older.promise,
      isLatest,
    );
    state.pending = pending;
    const newerRequest = startRosterRequest(
      state,
      generation,
      newer.promise,
      isLatest,
    );

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        rosterRaceView(state, (selection) => unavailable.push(selection)),
      );
      await Promise.resolve();
    });
    expect(unavailable).toEqual([]);

    await act(async () => {
      newer.resolve({ ok: true, familiars: [target] });
      await newerRequest;
      renderer.update(
        rosterRaceView(state, (selection) => unavailable.push(selection)),
      );
      await Promise.resolve();
    });
    expect(state).toEqual({
      familiars: [target],
      pending,
      settled: pending,
      error: null,
      loaded: true,
      loadedSuccessfully: true,
    });
    expect(captured.overlays.at(-1)).toEqual({
      familiarId: target.id,
      pendingId: pending.id,
    });

    const winningRoster = state.familiars;
    await act(async () => {
      older.resolve({ ok: true, familiars: [other] });
      await olderRequest;
    });
    expect(state.familiars).toBe(winningRoster);
    expect(state).toEqual({
      familiars: [target],
      pending,
      settled: pending,
      error: null,
      loaded: true,
      loadedSuccessfully: true,
    });
    expect(unavailable).toEqual([]);
    expect(captured.overlays.at(-1)).toEqual({
      familiarId: target.id,
      pendingId: pending.id,
    });
    await act(async () => renderer.unmount());
  });

  test("an older daemon-error payload cannot overwrite a newer success", async () => {
    const isLatest = canonicalMemory.isLatestFamiliarRosterRequest;
    expect(isLatest).toBeTypeOf("function");

    const generation = { current: 0 };
    const older = deferred<RosterResponse>();
    const newer = deferred<RosterResponse>();
    const state: RosterRaceState = {
      familiars: [other],
      pending,
      settled: null,
      error: null,
      loaded: false,
      loadedSuccessfully: true,
    };
    const olderRequest = startRosterRequest(
      state,
      generation,
      older.promise,
      isLatest,
    );
    const newerRequest = startRosterRequest(
      state,
      generation,
      newer.promise,
      isLatest,
    );

    await act(async () => {
      newer.resolve({ ok: true, familiars: [target] });
      await newerRequest;
    });
    expect(state.settled).toBe(pending);

    await act(async () => {
      older.resolve({ ok: false, error: "stale daemon error" });
      await olderRequest;
    });
    expect(state).toEqual({
      familiars: [target],
      pending,
      settled: pending,
      error: null,
      loaded: true,
      loadedSuccessfully: true,
    });
  });

  test("an older JSON parse failure cannot overwrite a newer success or a same-ID replacement selection", async () => {
    const isLatest = canonicalMemory.isLatestFamiliarRosterRequest;
    expect(isLatest).toBeTypeOf("function");

    const generation = { current: 0 };
    const older = deferred<RosterResponse>();
    const newer = deferred<RosterResponse>();
    const olderSelection = { ...pending };
    const newerSelection = { ...pending };
    const state: RosterRaceState = {
      familiars: [other],
      pending: olderSelection,
      settled: null,
      error: null,
      loaded: false,
      loadedSuccessfully: true,
    };
    const olderRequest = startRosterRequest(
      state,
      generation,
      older.promise,
      isLatest,
    );
    state.pending = newerSelection;
    const newerRequest = startRosterRequest(
      state,
      generation,
      newer.promise,
      isLatest,
    );

    await act(async () => {
      newer.resolve({ ok: true, familiars: [target] });
      await newerRequest;
    });
    expect(state.pending).toBe(newerSelection);
    expect(state.settled).toBe(newerSelection);

    await act(async () => {
      older.reject(new SyntaxError("stale roster JSON"));
      await olderRequest;
    });
    expect(state.familiars).toEqual([target]);
    expect(state.pending).toBe(newerSelection);
    expect(state.settled).toBe(newerSelection);
    expect(state.error).toBeNull();
    expect(state.loaded).toBe(true);
    expect(state.loadedSuccessfully).toBe(true);
  });

  test("an older target success cannot undo a newer terminal missing response", async () => {
    const isLatest = canonicalMemory.isLatestFamiliarRosterRequest;
    expect(isLatest).toBeTypeOf("function");

    const generation = { current: 0 };
    const older = deferred<RosterResponse>();
    const newer = deferred<RosterResponse>();
    const state: RosterRaceState = {
      familiars: [other],
      pending: null,
      settled: null,
      error: "prior error",
      loaded: false,
      loadedSuccessfully: false,
    };
    const unavailable: Array<typeof pending> = [];
    const olderRequest = startRosterRequest(
      state,
      generation,
      older.promise,
      isLatest,
    );
    state.pending = pending;
    const newerRequest = startRosterRequest(
      state,
      generation,
      newer.promise,
      isLatest,
    );
    const onUnavailable = (expected: typeof pending) => {
      unavailable.push(expected);
      state.pending =
        canonicalMemory.rejectPendingCanonicalMemorySelection(
          state.pending,
          expected,
        );
      if (state.settled === expected) state.settled = null;
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(rosterRaceView(state, onUnavailable));
      await Promise.resolve();
    });
    await act(async () => {
      newer.resolve({ ok: true, familiars: [] });
      await newerRequest;
      renderer.update(rosterRaceView(state, onUnavailable));
      await Promise.resolve();
    });
    expect(unavailable).toEqual([pending]);
    expect(state).toEqual({
      familiars: [],
      pending: null,
      settled: null,
      error: null,
      loaded: true,
      loadedSuccessfully: true,
    });

    await act(async () => {
      older.resolve({ ok: true, familiars: [target] });
      await olderRequest;
    });
    expect(state).toEqual({
      familiars: [],
      pending: null,
      settled: null,
      error: null,
      loaded: true,
      loadedSuccessfully: true,
    });
    expect(unavailable).toEqual([pending]);
    expect(captured.overlays).toEqual([]);
    await act(async () => renderer.unmount());
  });
});

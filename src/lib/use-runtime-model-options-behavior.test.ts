// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import {
  useRuntimeModelInventory,
  type RuntimeModelInventoryResult,
} from "./use-runtime-model-options.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type DeferredResponse = {
  url: string;
  resolve: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
};

function Probe({ runtime = "claude", familiarId, snapshots }: {
  runtime?: string;
  familiarId: string;
  snapshots: RuntimeModelInventoryResult[];
}) {
  snapshots.push(useRuntimeModelInventory(runtime, familiarId));
  return createElement("inventory-probe");
}

function inventory(familiarId: string, provenance = "live") {
  const freshness = provenance === "live" ? "fresh" : provenance === "cached" ? "cached" : "seed";
  return {
    ok: true,
    runtime: "claude",
    models: [{ id: `anthropic/${familiarId}`, label: familiarId }],
    provenance,
    freshness,
    refreshState: provenance === "live" || provenance === "cached" ? "ready" : "degraded",
    availability: provenance === "live" || provenance === "cached" ? "available" : "degraded",
    defaultOwner: "cave",
    allowCustom: false,
    scope: {
      familiarId,
      runtime: "claude",
      provider: "anthropic",
      credentialScope: "familiar",
      providerConfiguration: "familiar",
    },
  };
}

async function settle(request: DeferredResponse, payload: unknown) {
  await act(async () => {
    request.resolve({ ok: true, json: async () => payload });
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("runtime inventory masks scope transitions and preserves same-scope refreshes", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const pending: DeferredResponse[] = [];
  let poll: (() => void) | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return await new Promise((resolve) => pending.push({ url, resolve }));
  }) as typeof fetch;
  globalThis.setInterval = ((callback: () => void) => {
    poll = callback;
    return 1;
  }) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;

  const snapshots: RuntimeModelInventoryResult[] = [];
  let renderer: ReturnType<typeof create> | null = null;
  try {
    await act(async () => {
      renderer = create(createElement(Probe, { familiarId: "familiar-a", snapshots }));
    });
    assert.equal(pending[0]?.url, "/api/runtime-models/claude?familiarId=familiar-a");
    assert.deepEqual(snapshots.at(-1)?.models, []);
    assert.equal(snapshots.at(-1)?.loading, true);
    await settle(pending.shift()!, inventory("familiar-a"));
    assert.deepEqual(snapshots.at(-1)?.models.map((model) => model.id), [
      "anthropic/familiar-a",
    ]);
    assert.equal(snapshots.at(-1)?.allowCustom, false);

    snapshots.length = 0;
    await act(async () => { poll?.(); });
    assert.equal(pending.length, 1, "the bounded poll starts a same-scope refresh");
    assert.ok(
      snapshots.every((snapshot) =>
        snapshot.models.some((model) => model.id === "anthropic/familiar-a") &&
        !snapshot.loading
      ),
      "a same-scope refresh keeps the last validated inventory mounted",
    );
    await settle(pending.shift()!, inventory("familiar-a", "cached"));

    snapshots.length = 0;
    await act(async () => {
      renderer!.update(createElement(Probe, {
        familiarId: "familiar-b",
        snapshots,
      }));
    });
    assert.equal(pending[0]?.url, "/api/runtime-models/claude?familiarId=familiar-b");
    assert.ok(
      snapshots.every((snapshot) =>
        snapshot.models.length === 0 &&
        snapshot.loading &&
        snapshot.provenance === "unavailable"
      ),
      "a changed familiar never renders the prior familiar's model ids or provenance",
    );

    await settle(pending.shift()!, {
      ...inventory("familiar-b"),
      allowCustom: undefined,
    });
    assert.equal(snapshots.at(-1)?.loading, false);
    assert.equal(snapshots.at(-1)?.provenance, "fallback");
    assert.equal(
      snapshots.at(-1)?.models.some((model) => model.id === "anthropic/familiar-a"),
      false,
      "an invalid full-inventory response falls back instead of applying partial data",
    );
  } finally {
    await act(async () => { renderer?.unmount(); });
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("Hermes transport failures never reconstruct static OpenAI seeds", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  globalThis.setInterval = (() => 1) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;

  const snapshots: RuntimeModelInventoryResult[] = [];
  let renderer: ReturnType<typeof create> | null = null;
  try {
    await act(async () => {
      renderer = create(createElement(Probe, {
        runtime: "hermes",
        familiarId: "sage",
        snapshots,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const settled = snapshots.at(-1);
    assert.equal(settled?.loading, false);
    assert.equal(settled?.provenance, "runtime-managed");
    assert.deepEqual(settled?.models, []);
    assert.equal(
      settled?.models.some((model) => model.id.startsWith("openai/")),
      false,
    );
  } finally {
    await act(async () => { renderer?.unmount(); });
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("a completed config write retries a Hermes request that raced the save", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const pending: DeferredResponse[] = [];
  const browserEvents = new EventTarget();
  const documentEvents = new EventTarget();
  Object.defineProperty(documentEvents, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserEvents,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentEvents,
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return await new Promise((resolve) => pending.push({ url, resolve }));
  }) as typeof fetch;
  globalThis.setInterval = (() => 1) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;

  const snapshots: RuntimeModelInventoryResult[] = [];
  let renderer: ReturnType<typeof create> | null = null;
  try {
    await act(async () => {
      renderer = create(createElement(Probe, {
        runtime: "hermes",
        familiarId: "sage",
        snapshots,
      }));
    });
    assert.equal(pending.length, 1, "the optimistic runtime starts discovery");
    await settle(pending.shift()!, {
      ok: true,
      runtime: "hermes",
      models: [],
      provenance: "runtime-managed",
      freshness: "runtime-managed",
      refreshState: "degraded",
      availability: "degraded",
      defaultOwner: "runtime",
      allowCustom: false,
      scope: {
        familiarId: "sage",
        runtime: "hermes",
        provider: "openai",
        credentialScope: "familiar",
        providerConfiguration: "familiar",
      },
    });

    snapshots.length = 0;
    await act(async () => {
      browserEvents.dispatchEvent(new Event("cave:familiars-refresh"));
    });
    assert.equal(
      pending.length,
      1,
      "the post-save event starts a same-key retry without waiting for the poll",
    );
    assert.ok(
      snapshots.every((snapshot) => snapshot.models.length === 0 && snapshot.loading),
      "a config/profile change masks the prior inventory before its replacement arrives",
    );
    await settle(pending.shift()!, {
      ok: true,
      runtime: "hermes",
      models: [{ id: "openrouter/auto", label: "OpenRouter Auto" }],
      provenance: "live",
      freshness: "fresh",
      refreshState: "ready",
      availability: "available",
      defaultOwner: "runtime",
      allowCustom: false,
      scope: {
        familiarId: "sage",
        runtime: "hermes",
        provider: "openai",
        credentialScope: "familiar",
        providerConfiguration: "familiar",
      },
    });
    assert.deepEqual(
      snapshots.at(-1)?.models.map((model) => model.id),
      ["openrouter/auto"],
    );
    assert.equal(snapshots.at(-1)?.provenance, "live");
  } finally {
    await act(async () => { renderer?.unmount(); });
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  }
});

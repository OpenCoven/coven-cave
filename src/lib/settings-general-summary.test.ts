import assert from "node:assert/strict";
import test from "node:test";

import {
  createGeneralSummaryLoader,
  resolveGeneralSummaryState,
  type GeneralSummaryResponse,
  type GeneralSummaryState,
} from "./settings-general-summary.ts";

const ok = (value: Record<string, unknown>): GeneralSummaryResponse => ({
  ok: true,
  value,
});
const failed: GeneralSummaryResponse = { ok: false, value: null };
const loading: GeneralSummaryState = { status: "loading", summary: {} };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("General summary resolves complete source data", () => {
  assert.deepEqual(
    resolveGeneralSummaryState(loading, {
      config: ok({ workspacePath: "/coven" }),
      sync: ok({ config: { enabled: false } }),
    }),
    {
      status: "ready",
      summary: {
        workspacePath: "/coven",
        syncEnabled: false,
      },
    },
  );
});

test("General summary exposes partial refreshes while retaining failed-source values", () => {
  const current: GeneralSummaryState = {
    status: "ready",
    summary: {
      workspacePath: "/old",
      syncEnabled: false,
    },
  };

  assert.deepEqual(
    resolveGeneralSummaryState(current, {
      config: ok({ workspacePath: "/new" }),
      sync: failed,
    }),
    {
      status: "partial",
      summary: {
        workspacePath: "/new",
        syncEnabled: false,
      },
    },
  );
});

test("General summary treats an unusable successful payload as a partial source failure", () => {
  assert.deepEqual(
    resolveGeneralSummaryState(loading, {
      config: ok({ workspacePath: "/coven" }),
      sync: ok({ config: {} }),
    }),
    {
      status: "partial",
      summary: {
        workspacePath: "/coven",
      },
    },
  );
});

test("General summary treats all-source failure as an error without discarding known values", () => {
  const current: GeneralSummaryState = {
    status: "ready",
    summary: {
      workspacePath: "/coven",
      syncEnabled: true,
    },
  };

  assert.deepEqual(
    resolveGeneralSummaryState(current, {
      config: failed,
      sync: failed,
    }),
    {
      status: "error",
      summary: current.summary,
    },
  );
});

test("General summary errors when successful responses contain no usable details", () => {
  assert.deepEqual(
    resolveGeneralSummaryState(loading, {
      config: ok({ workspacePath: "" }),
      sync: ok({ config: {} }),
    }),
    {
      status: "error",
      summary: {},
    },
  );
});

test("General summary loader aborts superseded refreshes and keeps the newest result", async () => {
  const calls: Array<{
    input: string;
    signal: AbortSignal | undefined;
    request: ReturnType<typeof deferred<Response>>;
  }> = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = deferred<Response>();
    const signal = init?.signal ?? undefined;
    signal?.addEventListener("abort", () => request.reject(new Error(`aborted ${String(input)}`)), {
      once: true,
    });
    calls.push({ input: String(input), signal, request });
    return request.promise;
  }) as typeof fetch;
  const loader = createGeneralSummaryLoader({ fetchImpl });

  const firstLoad = loader.load();
  assert.equal(calls.length, 2, "one summary load fans out to the two narrow sources");
  assert.deepEqual(calls.map((call) => call.input), ["/api/config", "/api/backup/sync"]);
  const firstSignals = calls.slice(0, 2).map((call) => call.signal);

  const secondLoad = loader.load();
  assert.equal(calls.length, 4, "a refresh starts a new two-source batch");
  for (const signal of firstSignals) {
    assert.equal(signal?.aborted, true, "superseded summary loads should be aborted");
  }

  calls[2].request.resolve(jsonResponse({ ok: true, workspacePath: "/coven" }));
  calls[3].request.resolve(jsonResponse({ ok: true, config: { enabled: true } }));

  const [firstResult, secondResult] = await Promise.all([firstLoad, secondLoad]);
  assert.equal(firstResult, null, "a superseded load should not publish stale data");
  assert.deepEqual(secondResult, {
    config: ok({ ok: true, workspacePath: "/coven" }),
    sync: ok({ ok: true, config: { enabled: true } }),
  });
});

test("General summary loader aborts the active request on dispose", async () => {
  const calls: Array<{
    signal: AbortSignal | undefined;
    request: ReturnType<typeof deferred<Response>>;
  }> = [];
  const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) => {
    const request = deferred<Response>();
    const signal = init?.signal ?? undefined;
    signal?.addEventListener("abort", () => request.reject(new Error("aborted")), {
      once: true,
    });
    calls.push({ signal, request });
    return request.promise;
  }) as typeof fetch;
  const loader = createGeneralSummaryLoader({ fetchImpl });

  const load = loader.load();
  loader.dispose();

  assert.equal(calls.length, 2, "dispose should abort the in-flight two-source batch");
  for (const call of calls) {
    assert.equal(call.signal?.aborted, true);
  }
  assert.equal(await load, null, "a disposed loader should drop the abandoned result");
});

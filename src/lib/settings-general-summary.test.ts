import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("General summary resolves complete source data", () => {
  assert.deepEqual(
    resolveGeneralSummaryState(loading, {
      config: ok({ workspacePath: "/coven" }),
      voice: ok({
        tts: [
          { ready: true, verified: true },
          { ready: true, verified: false },
        ],
      }),
      sync: ok({ config: { enabled: false } }),
    }),
    {
      status: "ready",
      summary: {
        workspacePath: "/coven",
        readyVoices: 1,
        totalVoices: 2,
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
      readyVoices: 2,
      totalVoices: 4,
      syncEnabled: false,
    },
  };

  assert.deepEqual(
    resolveGeneralSummaryState(current, {
      config: ok({ workspacePath: "/new" }),
      voice: failed,
      sync: failed,
    }),
    {
      status: "partial",
      summary: {
        workspacePath: "/new",
        readyVoices: 2,
        totalVoices: 4,
        syncEnabled: false,
      },
    },
  );
});

test("General summary treats an unusable successful payload as a partial source failure", () => {
  assert.deepEqual(
    resolveGeneralSummaryState(loading, {
      config: ok({ workspacePath: "/coven" }),
      voice: ok({ ok: true }),
      sync: ok({ config: { enabled: false } }),
    }),
    {
      status: "partial",
      summary: {
        workspacePath: "/coven",
        syncEnabled: false,
      },
    },
  );
});

test("General summary treats all-source failure as an error without discarding known values", () => {
  const current: GeneralSummaryState = {
    status: "ready",
    summary: {
      workspacePath: "/coven",
      readyVoices: 0,
      totalVoices: 0,
      syncEnabled: true,
    },
  };

  assert.deepEqual(
    resolveGeneralSummaryState(current, {
      config: failed,
      voice: failed,
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
      voice: ok({}),
      sync: ok({ config: {} }),
    }),
    {
      status: "error",
      summary: {},
    },
  );
});

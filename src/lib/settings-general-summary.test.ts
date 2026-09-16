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

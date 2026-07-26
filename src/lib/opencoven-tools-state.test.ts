import assert from "node:assert/strict";
import {
  openCovenToolActionLabel,
  openCovenToolPresentation,
  openCovenToolState,
  type OpenCovenToolStateInput,
} from "./opencoven-tools-state.ts";

const base: OpenCovenToolStateInput = {
  installed: true,
  current: "1.2.0",
  latest: "1.2.0",
  outdated: false,
  compatible: true,
  minimumVersion: "1.0.0",
};

const cases: Array<{
  name: string;
  input: OpenCovenToolStateInput;
  state: ReturnType<typeof openCovenToolState>;
  action: "install" | "repair" | "update" | null;
  copy: string;
}> = [
  {
    name: "missing binary",
    input: { ...base, installed: false, current: null, latest: null, compatible: false },
    state: "missing",
    action: "install",
    copy: "Not found",
  },
  {
    name: "unreadable version",
    input: { ...base, current: null, compatible: false },
    state: "version-unreadable",
    action: "repair",
    copy: "Version unreadable",
  },
  {
    name: "below minimum",
    input: { ...base, current: "0.9.0", latest: null, compatible: false },
    state: "below-minimum",
    action: "update",
    copy: "requires >= 1.0.0",
  },
  {
    name: "update available",
    input: { ...base, latest: "1.3.0", outdated: true },
    state: "outdated",
    action: "update",
    copy: "Update available",
  },
  {
    name: "current",
    input: base,
    state: "current",
    action: null,
    copy: "Current and compatible",
  },
  {
    name: "latest unavailable",
    input: { ...base, latest: null },
    state: "latest-unknown",
    action: null,
    copy: "npm latest is unavailable",
  },
];

for (const testCase of cases) {
  const presentation = openCovenToolPresentation(testCase.input);
  assert.equal(presentation.state, testCase.state, testCase.name);
  assert.equal(presentation.action, testCase.action, `${testCase.name} action`);
  assert.ok(
    presentation.statusText.includes(testCase.copy),
    `${testCase.name} copy`,
  );
}

assert.equal(
  openCovenToolActionLabel("install", "Coven CLI"),
  "Install Coven CLI",
  "missing tools offer an explicit install action",
);
assert.equal(
  openCovenToolActionLabel("repair", "Coven Code"),
  "Repair Coven Code",
  "unreadable tools offer a repair action",
);

const recoveryTransitions: Array<{
  name: string;
  before: OpenCovenToolStateInput;
  afterRecheck: OpenCovenToolStateInput;
}> = [
  {
    name: "install a missing binary then recheck",
    before: { ...base, installed: false, current: null, latest: null, compatible: false },
    afterRecheck: base,
  },
  {
    name: "repair a broken shim then recheck",
    before: { ...base, current: null, compatible: false },
    afterRecheck: base,
  },
  {
    name: "update a below-minimum binary then recheck",
    before: { ...base, current: "0.9.0", latest: null, compatible: false },
    afterRecheck: base,
  },
  {
    name: "update an outdated binary then recheck",
    before: { ...base, latest: "1.3.0", outdated: true },
    afterRecheck: { ...base, current: "1.3.0", latest: "1.3.0" },
  },
];

for (const transition of recoveryTransitions) {
  assert.notEqual(
    openCovenToolState(transition.before),
    "current",
    `${transition.name} must begin in a recoverable non-current state`,
  );
  assert.equal(
    openCovenToolState(transition.afterRecheck),
    "current",
    `${transition.name} must become current only after the status recheck`,
  );
}

console.log("opencoven-tools-state.test.ts: ok");

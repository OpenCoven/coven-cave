import assert from "node:assert/strict";
import {
  openCovenToolActionTargets,
  openCovenToolsInstallCommand,
  openCovenToolsPrimaryActionLabel,
  type OpenCovenToolInstallStatus,
} from "./opencoven-tools-install.ts";

const cliMissing: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: false,
  outdated: false,
  compatible: false,
};

const cliOutdated: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: true,
  outdated: true,
  compatible: true,
};

const cliBelowFloor: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: true,
  outdated: false,
  compatible: false,
};

const cliCompatibilityUnknown: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: true,
  outdated: false,
};

const cliReady: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: true,
  outdated: false,
  compatible: true,
};

// `null` means the status route could not produce authoritative local tool
// evidence. It must stay a checking state rather than inventing an install.
assert.deepEqual(
  openCovenToolActionTargets(null),
  [],
  "unknown local evidence yields no install target",
);
assert.equal(
  openCovenToolsPrimaryActionLabel(null),
  "Checking local installation…",
  "unknown local evidence keeps the primary action in a checking state",
);

// An actual empty array is authoritative: no CLI was found, so setup falls
// back to the one required OpenCoven tool.
assert.deepEqual(
  openCovenToolActionTargets([]),
  ["coven-cli"],
  "an authoritative empty result installs the required Coven CLI",
);
assert.equal(
  openCovenToolsInstallCommand([]),
  "npm i -g @opencoven/cli@latest",
  "the fresh-install command uses only the scoped Coven CLI package",
);
assert.equal(
  openCovenToolsPrimaryActionLabel([]),
  "Install the Coven CLI",
  "the fresh-install action names the single required tool",
);

assert.deepEqual(
  openCovenToolActionTargets([cliMissing]),
  ["coven-cli"],
  "a confirmed missing CLI is actionable",
);
assert.equal(
  openCovenToolsPrimaryActionLabel([cliMissing]),
  "Install the Coven CLI",
  "the required missing CLI keeps the reviewed install copy",
);

assert.deepEqual(
  openCovenToolActionTargets([cliOutdated]),
  [],
  "a compatible CLI is not reinstalled merely because npm has a newer release",
);
assert.equal(
  openCovenToolsPrimaryActionLabel([cliOutdated]),
  "Coven CLI ready",
  "an installed compatible CLI remains ready when npm has a newer release",
);

assert.deepEqual(
  openCovenToolActionTargets([cliBelowFloor]),
  ["coven-cli"],
  "an explicitly incompatible CLI is actionable without latest metadata",
);
assert.equal(
  openCovenToolsPrimaryActionLabel([cliBelowFloor]),
  "Update Coven CLI",
  "an installed below-floor CLI gets an update action",
);

assert.deepEqual(
  openCovenToolActionTargets([cliCompatibilityUnknown]),
  [],
  "missing compatibility metadata alone does not invent a failure",
);
assert.deepEqual(
  openCovenToolActionTargets([cliReady]),
  [],
  "a current compatible CLI needs no action",
);
assert.equal(
  openCovenToolsPrimaryActionLabel([cliReady]),
  "Coven CLI ready",
  "a satisfied CLI reads as ready",
);

assert.equal(
  openCovenToolsInstallCommand([cliOutdated]),
  "npm i -g @opencoven/cli@latest",
  "updates target only the unified Coven CLI package",
);
assert.equal(
  openCovenToolsInstallCommand([cliReady]),
  "npm i -g @opencoven/cli@latest",
  "the manual command remains useful even when no automatic action is pending",
);

console.log("opencoven-tools-install.test.ts: ok");

import assert from "node:assert/strict";
import {
  openCovenToolActionTargets,
  openCovenToolsInstallCommand,
  openCovenToolsPrimaryActionLabel,
  type OpenCovenToolInstallStatus,
} from "./opencoven-tools-install.ts";

const cliOutdated: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: true,
  outdated: true,
};

const cliReady: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: true,
  outdated: false,
  compatible: true,
};

const cliMissing: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: false,
  outdated: false,
  compatible: false,
};

const cliBelowFloor: OpenCovenToolInstallStatus = {
  id: "coven-cli",
  label: "Coven CLI",
  installed: true,
  outdated: false,
  compatible: false,
};


// The Coven CLI is the only required OpenCoven tool — a fresh setup (status
// not loaded yet) must not claim Coven Code is needed.
assert.deepEqual(
  openCovenToolActionTargets([]),
  ["coven-cli"],
  "fresh setup falls back to installing the Coven CLI only",
);

assert.equal(
  openCovenToolsInstallCommand([]),
  "npm i -g @opencoven/cli@latest",
  "fresh setup manual command installs the Coven CLI only (scoped package)",
);

assert.equal(
  openCovenToolsPrimaryActionLabel([]),
  "Install the Coven CLI",
  "fresh setup primary action names the single required tool",
);

assert.deepEqual(
  openCovenToolActionTargets([cliMissing]),
  ["coven-cli"],
  "missing CLI is actionable",
);

assert.deepEqual(
  openCovenToolActionTargets([cliOutdated]),
  ["coven-cli"],
  "outdated CLI is actionable",
);

assert.deepEqual(
  openCovenToolActionTargets([cliBelowFloor]),
  ["coven-cli"],
  "a tool below Cave's compatibility floor is actionable even when latest metadata is unavailable",
);

assert.deepEqual(
  openCovenToolActionTargets([cliReady]),
  [],
  "a current, verified CLI needs no action",
);

assert.equal(
  openCovenToolsInstallCommand([cliOutdated]),
  "npm i -g @opencoven/cli@latest",
  "manual command targets the CLI",
);

assert.equal(
  openCovenToolsPrimaryActionLabel([cliOutdated]),
  "Update Coven CLI",
  "primary action label reflects a single CLI update",
);

assert.equal(
  openCovenToolsPrimaryActionLabel([cliMissing]),
  "Install Coven CLI",
  "primary action label reflects a fresh CLI install",
);

assert.equal(
  openCovenToolsPrimaryActionLabel([cliReady]),
  "Coven CLI ready",
  "a satisfied CLI reads as ready",
);

// After unification, @opencoven/cli self-manages the engine. There is no
// separate optional coven-code install target anymore.
assert.equal(
  openCovenToolsInstallCommand([cliOutdated]),
  "npm i -g @opencoven/cli@latest",
  "install command targets only the CLI after unification",
);

console.log("opencoven-tools-install.test.ts: ok");

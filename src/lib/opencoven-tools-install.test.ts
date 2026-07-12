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

const codeReady: OpenCovenToolInstallStatus = {
  id: "coven-code",
  label: "Coven Code",
  installed: true,
  outdated: false,
};

const codeMissing: OpenCovenToolInstallStatus = {
  id: "coven-code",
  label: "Coven Code",
  installed: false,
  outdated: false,
};

assert.deepEqual(
  openCovenToolActionTargets([]),
  ["coven-cli", "coven-code"],
  "fresh setup falls back to installing both OpenCoven tools",
);

assert.equal(
  openCovenToolsInstallCommand([]),
  "npm i -g @opencoven/cli@latest @opencoven/coven-code@latest",
  "fresh setup manual command installs both required OpenCoven tools (scoped packages only)",
);

assert.deepEqual(
  openCovenToolActionTargets([cliOutdated, codeReady]),
  ["coven-cli"],
  "when Coven Code is already current, the primary action only updates the CLI",
);

assert.equal(
  openCovenToolsInstallCommand([cliOutdated, codeReady]),
  "npm i -g @opencoven/cli@latest",
  "manual command matches the single outdated tool instead of claiming to install both",
);

assert.equal(
  openCovenToolsPrimaryActionLabel([cliOutdated, codeReady]),
  "Update Coven CLI",
  "primary action label reflects a single CLI update",
);

assert.equal(
  openCovenToolsPrimaryActionLabel([cliOutdated, codeMissing]),
  "Update OpenCoven tools",
  "mixed missing/outdated tools get a neutral update label",
);

console.log("opencoven-tools-install.test.ts: ok");

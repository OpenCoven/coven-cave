import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_NODE_VERSION,
  nodeArchiveFor,
  prerequisiteById,
  resolvePrerequisites,
} from "./onboarding-prerequisites.ts";

test("desktop runtime resolution never makes host Node, Corepack, or pnpm a launch requirement", () => {
  const resolved = resolvePrerequisites({ platform: "win32", architecture: "x64", capabilities: [] });
  assert.deepEqual(resolved.map((entry) => entry.id), ["windows-webview2"]);
});

test("local familiar resolution establishes managed Node before Coven", () => {
  const resolved = resolvePrerequisites({
    platform: "linux",
    architecture: "arm64",
    capabilities: ["local-familiar"],
  });
  assert.deepEqual(resolved.map((entry) => entry.id), ["linux-desktop-runtime", "managed-node", "coven-cli"]);
});

test("runtime selection depends on the complete managed local-runtime lane", () => {
  const resolved = resolvePrerequisites({
    platform: "darwin",
    architecture: "x64",
    capabilities: ["runtime"],
  });
  assert.deepEqual(resolved.map((entry) => entry.id), ["macos-app-runtime", "managed-node", "coven-cli", "runtime-claude", "runtime-codex", "runtime-copilot", "runtime-openclaw"]);
});

test("mobile resolves the remote daemon path rather than local Node or Coven", () => {
  const resolved = resolvePrerequisites({ platform: "ios", architecture: "arm64", capabilities: ["phone-handoff"] });
  assert.deepEqual(resolved.map((entry) => entry.id), ["mobile-remote-daemon", "tailscale"]);
});

test("Node archives are fixed to the reviewed release, official origin, digest, and bounded size", () => {
  const archive = nodeArchiveFor("win32", "x64");
  assert.ok(archive);
  assert.match(archive.url, new RegExp(`^https://nodejs\\.org/dist/v${MANAGED_NODE_VERSION}/`));
  assert.match(archive.sha256, /^[a-f0-9]{64}$/);
  assert.equal(archive.format, "zip");
  assert.ok(archive.maxBytes > 0);
  assert.equal(nodeArchiveFor("ios", "arm64"), null);
});

test("npm installers are exact manifest records and Hermes remains manual-only", () => {
  const coven = prerequisiteById("coven-cli");
  assert.equal(coven.install.kind, "managed-npm");
  if (coven.install.kind === "managed-npm") {
    assert.equal(coven.install.package.packageName, "@opencoven/cli");
    assert.equal(coven.install.package.version, "0.2.5");
    assert.equal(
      coven.install.package.integrity,
      "sha512-qZ9nn1MsEf0P4fGHLezaX95VepBnY3dQPBPwcrmBJuFeCt5CeIYA/EVKPalfaSwWAAFj8J0YLugkBALH4JKdDw==",
    );
  }
  assert.equal(prerequisiteById("runtime-codex").dependsOn?.includes("coven-cli"), true);
});

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

test("Node archives exactly match the reviewed Node.js 24.18.0 release manifest", () => {
  const expected = {
    "win32-x64": ["zip", "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821"],
    "win32-arm64": ["zip", "f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01"],
    "darwin-x64": ["tar.gz", "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080"],
    "darwin-arm64": ["tar.gz", "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1"],
    "linux-x64": ["tar.gz", "783130984963db7ba9cbd01089eaf2c2efb055c7c1693c943174b967b3050cb8"],
    "linux-arm64": ["tar.gz", "6b4484c2190274175df9aa8f28e2d758a819cb1c1fe6ab481e2f95b463ab8508"],
  } as const;

  for (const [target, [format, sha256]] of Object.entries(expected)) {
    const [platform, architecture] = target.split("-") as ["win32" | "darwin" | "linux", "x64" | "arm64"];
    const archive = nodeArchiveFor(platform, architecture);
    assert.ok(archive, `expected an archive for ${target}`);
    const archivePlatform = platform === "win32" ? "win" : platform;
    assert.equal(archive.url, `https://nodejs.org/dist/v${MANAGED_NODE_VERSION}/node-v${MANAGED_NODE_VERSION}-${archivePlatform}-${architecture}.${format}`);
    assert.equal(archive.sha256, sha256);
    assert.equal(archive.maxBytes, 128_000_000);
  }

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

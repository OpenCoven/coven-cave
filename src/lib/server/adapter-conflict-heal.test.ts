// Tests for adapter-conflict-heal (cave-1c05): recovery from the Coven CLI's
// fatal "external harness adapter `x` … conflicts with a built-in harness"
// registry error, which bricked every `coven run` (chat surfaced it as codex
// turns ending "No assistant text returned").
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile as readFileFs, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  detectBuiltinAdapterConflict,
  healBuiltinShadowedManifest,
  isManifestShadowedByBuiltin,
  shadowedMarkerPath,
  SHADOWED_MANIFEST_SUFFIX,
} from "./adapter-conflict-heal.ts";
import { ensureAdapterManifestScaffold } from "./adapter-manifest-scaffold.ts";
import { adapterManifestScaffoldForHarness } from "../harness-adapters.ts";

const CLI_ERROR =
  "Error: external harness adapter `copilot` in /Users/buns/.coven/adapters/copilot.json conflicts with a built-in harness";

test("detectBuiltinAdapterConflict parses the released CLI error line", () => {
  const conflict = detectBuiltinAdapterConflict(CLI_ERROR);
  assert.deepEqual(conflict, {
    id: "copilot",
    manifestPath: "/Users/buns/.coven/adapters/copilot.json",
  });
});

test("detectBuiltinAdapterConflict returns null for unrelated stderr", () => {
  assert.equal(detectBuiltinAdapterConflict("ERROR: token refresh failed"), null);
  assert.equal(detectBuiltinAdapterConflict(""), null);
});

test("heal renames a manifest inside the adapters root and marks it shadowed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adapters-"));
  const manifest = path.join(root, "copilot.json");
  await writeFile(manifest, "{}", "utf8");

  const healed = await healBuiltinShadowedManifest(
    { id: "copilot", manifestPath: manifest },
    root,
  );
  assert.equal(healed, true);
  await assert.rejects(stat(manifest), "original manifest must be gone");
  const marker = shadowedMarkerPath(manifest);
  assert.equal((await stat(marker)).isFile(), true);
  assert.equal(await readFileFs(marker, "utf8"), "{}");
  assert.equal(await isManifestShadowedByBuiltin(manifest), true);
});

test("heal refuses paths outside the adapters root (prefix-bypass included)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adapters-"));
  const evilSibling = `${root}-evasion`;
  const outside = path.join(evilSibling, "copilot.json");
  assert.equal(
    await healBuiltinShadowedManifest({ id: "copilot", manifestPath: outside }, root),
    false,
    "root-prefix sibling dir must not pass containment",
  );
  assert.equal(
    await healBuiltinShadowedManifest(
      { id: "copilot", manifestPath: "/etc/passwd" },
      root,
    ),
    false,
  );
  assert.equal(
    await healBuiltinShadowedManifest({ id: "copilot", manifestPath: root }, root),
    false,
    "the root itself is not a manifest",
  );
});

test("heal refuses non-.json paths and missing files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adapters-"));
  await writeFile(path.join(root, "notes.txt"), "x", "utf8");
  assert.equal(
    await healBuiltinShadowedManifest(
      { id: "notes", manifestPath: path.join(root, "notes.txt") },
      root,
    ),
    false,
  );
  assert.equal(
    await healBuiltinShadowedManifest(
      { id: "gone", manifestPath: path.join(root, "gone.json") },
      root,
    ),
    false,
  );
});

test("isManifestShadowedByBuiltin is false without the marker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adapters-"));
  const manifest = path.join(root, "copilot.json");
  await writeFile(manifest, "{}", "utf8");
  assert.equal(await isManifestShadowedByBuiltin(manifest), false);
});

test("marker suffix keeps quarantined files off the CLI's .json dir scan", () => {
  assert.ok(!shadowedMarkerPath("/x/copilot.json").endsWith(".json"));
  assert.ok(SHADOWED_MANIFEST_SUFFIX.startsWith("."));
});

test("Hermes manifest repair uses the active COVEN_HOME adapters directory", async () => {
  const covenHome = await mkdtemp(path.join(tmpdir(), "coven-home-"));
  const manifestPath = path.join(covenHome, "adapters", "hermes.json");
  const legacyManifest = adapterManifestScaffoldForHarness("hermes", "linux");
  assert.ok(legacyManifest);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, legacyManifest.contents, "utf8");
  const previous = process.env.COVEN_HOME;
  process.env.COVEN_HOME = covenHome;
  try {
    assert.equal(
      await ensureAdapterManifestScaffold("hermes", { platform: "win32" }),
      true,
    );
    const manifest = JSON.parse(await readFileFs(manifestPath, "utf8"));
    assert.equal(manifest.adapters[0].executable, "hermes");
    assert.equal(manifest.adapters[0].prompt_flag, "-q");
  } finally {
    if (previous === undefined) delete process.env.COVEN_HOME;
    else process.env.COVEN_HOME = previous;
  }
});

test("Hermes manifest repair preserves a formatting-only user manifest", async () => {
  const covenHome = await mkdtemp(path.join(tmpdir(), "coven-home-"));
  const manifestPath = path.join(covenHome, "adapters", "hermes.json");
  const legacyManifest = adapterManifestScaffoldForHarness("hermes", "linux");
  assert.ok(legacyManifest);
  const userContents = JSON.stringify(JSON.parse(legacyManifest.contents));
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, userContents, "utf8");

  assert.equal(
    await ensureAdapterManifestScaffold("hermes", { adaptersDir: path.dirname(manifestPath), platform: "win32" }),
    false,
  );
  assert.equal(await readFileFs(manifestPath, "utf8"), userContents);
});

// Wiring pins: the chat send route must detect the conflict from harness
// stderr and heal+retry; every scaffold site must route through the shared
// writer, which refuses to resurrect a quarantined manifest.
test("chat send route wires conflict detection and heal-retry", async () => {
  const source = await readFileFs(
    path.join(process.cwd(), "src/app/api/chat/send/route.ts"),
    "utf8",
  );
  assert.match(source, /detectBuiltinAdapterConflict\(text\)/);
  assert.match(source, /healBuiltinShadowedManifest\(conflict\)/);
  assert.match(source, /adapterConflict && !sshRuntime/);
  assert.match(source, /pushProgress\(\s*"adapter-heal"/);
});

test("scaffold sites use the shared quarantine-aware manifest writer", async () => {
  const helper = await readFileFs(
    path.join(process.cwd(), "src/lib/server/adapter-manifest-scaffold.ts"),
    "utf8",
  );
  assert.match(helper, /isManifestShadowedByBuiltin\(manifestPath\)/);
  for (const file of [
    "src/app/api/config/route.ts",
    "src/app/api/familiars/route.ts",
    "src/app/api/onboarding/setup/route.ts",
  ]) {
    const source = await readFileFs(path.join(process.cwd(), file), "utf8");
    assert.match(
      source,
      /ensureAdapterManifestScaffold/,
      `${file} must use the shared manifest writer`,
    );
  }
});

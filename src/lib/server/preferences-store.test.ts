// @ts-nocheck
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const root = await mkdtemp(path.join(os.tmpdir(), "cave-preferences-store-"));
const preferencesFile = path.join(root, "cave-preferences.json");
const legacyThemeFile = path.join(root, "cave-theme.json");
process.env.COVEN_PREFERENCES_PATH = preferencesFile;
process.env.COVEN_THEME_PATH = legacyThemeFile;

const schema = await import("../preferences-schema.ts");
const store = await import("./preferences-store.ts");

try {
  const empty = await store.loadPreferences();
  assert.equal(empty.initialized, false, "a missing canonical file remains migration-eligible");
  assert.equal(empty.appearance.theme.id, "coven");

  await writeFile(
    legacyThemeFile,
    JSON.stringify({
      themeId: "ember",
      mode: "light",
      tokens: { "--bg-base": "#120d0a", "not-a-token": "ignored" },
      updatedAt: "2026-07-11T12:00:00.000Z",
    }),
  );
  const recovered = await store.loadPreferences();
  assert.equal(recovered.initialized, false, "theme recovery must not block richer browser migration");
  assert.equal(recovered.appearance.theme.id, "ember");
  assert.equal(recovered.appearance.theme.modePreference, "light");
  assert.deepEqual(recovered.appearance.theme.tokens, { "--bg-base": "#120d0a" });
  await assert.rejects(readFile(preferencesFile), { code: "ENOENT" }, "SSR recovery must not create authority early");

  const initialized = await store.patchPreferences({
    appearance: {
      fonts: { serif: "eb-garamond", sans: "source-sans-3", mono: "source-code-pro" },
      screenScale: 125,
      reading: { leading: "relaxed", tracking: "wide" },
      datetime: { clock: "24h", date: "ddmm", density: "verbose" },
      cornerRadius: "round",
      backdrop: { enabled: true, intensity: 63, matchAccent: false },
    },
    general: { newsHeadlines: false },
    phone: { mobileMode: false },
  });
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.revision, 1);
  assert.equal(initialized.appearance.theme.id, "ember", "legacy theme survives richer first patch");

  const concurrent = await Promise.all([
    store.patchPreferences({ appearance: { reading: { align: "justify" } } }),
    store.patchPreferences({ appearance: { reading: { width: "narrow" } } }),
    store.patchPreferences({ appearance: { reading: { weight: "light", hyphens: "on" } } }),
    store.patchPreferences({ appearance: { recentColors: ["#112233", "#aabbcc"] } }),
    store.patchPreferences({ general: { newsHeadlines: true } }),
  ]);
  const afterConcurrent = await store.loadPreferences();
  assert.equal(afterConcurrent.appearance.reading.align, "justify");
  assert.equal(afterConcurrent.appearance.reading.width, "narrow");
  assert.equal(afterConcurrent.appearance.reading.weight, "light");
  assert.equal(afterConcurrent.appearance.reading.hyphens, "on");
  assert.deepEqual(afterConcurrent.appearance.recentColors, ["#112233", "#aabbcc"]);
  assert.equal(afterConcurrent.general.newsHeadlines, true);
  assert.deepEqual(
    concurrent.map((entry) => entry.revision),
    [2, 3, 4, 5, 6],
    "the global mutation chain assigns monotonic revisions in arrival order",
  );

  const intentsDir = `${preferencesFile}.locks`;
  const deadIntent = path.join(
    intentsDir,
    "000000000000000000000000-2147483647-deadbeef.lock",
  );
  await writeFile(deadIntent, "2147483647 crashed\n", "utf8");
  await store.patchPreferences({ phone: { mobileMode: false } });
  await assert.rejects(readFile(deadIntent), { code: "ENOENT" }, "dead process intents are recoverable");

  // Real packaged upgrades can briefly overlap old/new sidecars. Exercise
  // separate Node processes against one file so atomic rename alone (which is
  // only last-writer-wins) cannot silently lose disjoint patches.
  const crossProcessPatches = [
    { appearance: { screenScale: 150 } },
    { appearance: { reading: { leading: "compact" } } },
    { appearance: { reading: { tracking: "wider" } } },
    { appearance: { reading: { align: "left" } } },
    { appearance: { reading: { width: "medium" } } },
    { appearance: { reading: { weight: "medium" } } },
    { appearance: { reading: { hyphens: "off" } } },
    { appearance: { datetime: { clock: "12h" } } },
    { appearance: { datetime: { date: "off" } } },
    { appearance: { datetime: { density: "compact" } } },
    { appearance: { cornerRadius: "sharp" } },
    { general: { newsHeadlines: false } },
    { phone: { mobileMode: true } },
  ];
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const storeUrl = pathToFileURL(path.resolve("src/lib/server/preferences-store.ts")).href;
  const startAt = Date.now() + 1_500;
  const worker = `
    const wait = Math.max(0, Number(process.env.CAVE_TEST_START_AT) - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const { patchPreferences } = await import(${JSON.stringify(storeUrl)});
    await patchPreferences(JSON.parse(process.env.CAVE_TEST_PATCH));
  `;
  await Promise.all(crossProcessPatches.map((patchValue) => execFileAsync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import", loaderUrl,
      "--input-type=module",
      "--eval", worker,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COVEN_PREFERENCES_PATH: preferencesFile,
        COVEN_THEME_PATH: legacyThemeFile,
        CAVE_TEST_START_AT: String(startAt),
        CAVE_TEST_PATCH: JSON.stringify(patchValue),
      },
      windowsHide: true,
    },
  )));
  const afterCrossProcess = await store.loadPreferences();
  assert.equal(afterCrossProcess.revision, 6 + crossProcessPatches.length);
  assert.equal(afterCrossProcess.appearance.screenScale, 150);
  assert.deepEqual(afterCrossProcess.appearance.reading, {
    leading: "compact",
    tracking: "wider",
    align: "left",
    width: "medium",
    weight: "medium",
    hyphens: "off",
  });
  assert.deepEqual(afterCrossProcess.appearance.datetime, {
    clock: "12h",
    date: "off",
    density: "compact",
  });
  assert.equal(afterCrossProcess.appearance.cornerRadius, "sharp");
  assert.equal(afterCrossProcess.general.newsHeadlines, false);
  assert.equal(afterCrossProcess.phone.mobileMode, true);
  assert.deepEqual(
    (await readdir(intentsDir)).filter((name) => name.endsWith(".lock")),
    [],
    "each process releases only its own queue intent",
  );

  assert.throws(
    () => store.patchPreferences({ authToken: "must-never-persist" }),
    schema.PreferencesValidationError,
  );
  assert.throws(
    () => store.patchPreferences({ appearance: { theme: { id: "<script>" } } }),
    schema.PreferencesValidationError,
  );
  assert.doesNotMatch(await readFile(preferencesFile, "utf8"), /authToken|must-never-persist|<script>/);

  // A malformed file is recoverable, but is preserved for support before the
  // first successful replacement. It must never yield a partially parsed state.
  await writeFile(preferencesFile, "{ definitely not json", "utf8");
  await rm(legacyThemeFile, { force: true });
  const malformed = await store.loadPreferences();
  assert.equal(malformed.initialized, false);
  assert.equal(malformed.appearance.theme.id, "coven");
  const repaired = await store.patchPreferences({ phone: { mobileMode: false } });
  assert.equal(repaired.initialized, true);
  assert.equal(repaired.phone.mobileMode, false);
  const names = await readdir(root);
  assert.equal(
    names.some((name) => name.startsWith("cave-preferences.json.corrupt-")),
    true,
    "the malformed source is copied aside before replacement",
  );
  assert.equal(
    names.some((name) => name.endsWith(".tmp")),
    false,
    "successful atomic writes leave no temporary files",
  );

  // Empty initialization is meaningful for a genuinely fresh profile.
  await rm(preferencesFile, { force: true });
  const defaults = await store.patchPreferences({});
  assert.equal(defaults.initialized, true);
  assert.equal(defaults.revision, 1);
  assert.equal(JSON.parse(await readFile(preferencesFile, "utf8")).initialized, true);

  console.log("preferences-store.test.ts: ok");
} finally {
  delete process.env.COVEN_PREFERENCES_PATH;
  delete process.env.COVEN_THEME_PATH;
  await rm(root, { recursive: true, force: true });
}

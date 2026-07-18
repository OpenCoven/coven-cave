// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "cave-theme-adapter-"));
const preferencesFile = path.join(root, "cave-preferences.json");
// Hermetic coven home — keeps reconciliation off the REAL ~/.coven legacy
// symlinks, whose canonical targets differ from the temp overrides (threads-wro).
process.env.COVEN_HOME = path.join(root, "coven-home");
process.env.COVEN_PREFERENCES_PATH = preferencesFile;
process.env.COVEN_THEME_PATH = path.join(root, "missing-legacy-theme.json");

const route = await readFile(new URL("../../app/api/theme/route.ts", import.meta.url), "utf8");

try {
  const preferencesStore = await import("./preferences-store.ts");
  const themeStore = await import("./theme-store.ts");

  const initial = await themeStore.loadTheme();
  assert.equal(initial.themeId, "coven");
  assert.equal(initial.revision, 0);
  assert.equal(initial.selectionRevision, 0);

  const selected = await themeStore.saveTheme({
    themeId: "ember",
    modePreference: "light",
    resolvedMode: "light",
    tokens: { "--bg-base": "#120d0a" },
  });
  assert.equal(selected.themeId, "ember");
  assert.equal(selected.mode, "light");
  assert.equal(selected.revision, 1);
  assert.equal(selected.selectionRevision, 1);

  const tokenUpdate = await themeStore.saveTheme({
    tokenOnly: true,
    tokens: { "--bg-base": "#22110a", "not-a-token": "ignored" },
    expectedSelectionRevision: selected.selectionRevision,
  });
  assert.equal(tokenUpdate.revision, 2, "token publication is still a canonical preference write");
  assert.equal(
    tokenUpdate.selectionRevision,
    selected.selectionRevision,
    "token-only publication must not masquerade as a new theme selection",
  );
  assert.deepEqual(tokenUpdate.tokens, { "--bg-base": "#22110a" });

  const newerSelection = await themeStore.saveTheme({
    themeId: "tide",
    modePreference: "dark",
    resolvedMode: "dark",
  });
  assert.equal(newerSelection.selectionRevision, 3);

  await assert.rejects(
    themeStore.saveTheme({
      tokenOnly: true,
      tokens: { "--bg-base": "#ffffff" },
      expectedSelectionRevision: selected.selectionRevision,
    }),
    (error: unknown) => {
      assert.ok(error instanceof preferencesStore.PreferencesConflictError);
      assert.equal(error.current.appearance.theme.id, "tide");
      return true;
    },
    "a delayed token write must not overwrite a newer remote or local selection",
  );

  await assert.rejects(
    themeStore.saveTheme({ tokenOnly: true, tokens: {} }),
    TypeError,
    "token-only updates require an explicit selection revision",
  );

  const persisted = JSON.parse(await readFile(preferencesFile, "utf8"));
  assert.equal(persisted.appearance.theme.id, "tide");
  assert.equal(persisted.appearance.theme.tokens["--bg-base"], undefined);
  assert.equal(persisted.general.newsHeadlines, true);
  assert.equal(persisted.phone.mobileMode, true);
  assert.equal(
    Object.hasOwn(persisted, "themeId"),
    false,
    "the compatibility theme endpoint must persist through the canonical preference document",
  );

  assert.match(
    route,
    /PreferencesConflictError[\s\S]*status: 409/,
    "PUT /api/theme should surface stale selection revisions as conflicts",
  );
  assert.match(
    route,
    /themeSnapshotFromPreferences\(error\.current\)/,
    "a conflict response should return the winning canonical snapshot for reconciliation",
  );
  assert.match(
    route,
    /cache-control": "no-store"/,
    "theme compatibility responses must not cache canonical state",
  );

  console.log("theme-store.test.ts: ok");
} finally {
  delete process.env.COVEN_HOME;
  delete process.env.COVEN_PREFERENCES_PATH;
  delete process.env.COVEN_THEME_PATH;
  await rm(root, { recursive: true, force: true });
}

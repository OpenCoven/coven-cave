import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  readLegacySurfacePreferences,
  readSurfacePreferences,
  SURFACE_PREFERENCES_STORAGE_KEY,
  writeSurfacePreferences,
} from "./surface-preferences.ts";
import { surfacePreferenceSpecs } from "./surface-preference-specs.ts";

function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test("surface preferences round-trip valid values and reject malformed payloads", () => {
  const local = storage();
  writeSurfacePreferences(local, { "github.organization": "OpenCoven", "board.viewMode": "gantt" });
  assert.deepEqual(readSurfacePreferences(local), { "github.organization": "OpenCoven", "board.viewMode": "gantt" });
  local.setItem(SURFACE_PREFERENCES_STORAGE_KEY, "{not-json");
  assert.deepEqual(readSurfacePreferences(local), {});
  local.setItem(SURFACE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 99, values: { "github.organization": "wrong" } }));
  assert.deepEqual(readSurfacePreferences(local), {});
});

test("legacy fields migrate without replacing a new preference", () => {
  const local = storage({
    "cave:board:viewMode": "table",
    "cave:agents.lastSelected": "familiar-1",
    "cave:automations:familiar-filter": JSON.stringify(["beta", "alpha", 7]),
  });
  const legacy = readLegacySurfacePreferences(local);
  assert.deepEqual(legacy, {
    "board.viewMode": "table",
    "familiars.selectedId": "familiar-1",
    "familiars.viewMode": "detail",
    "schedules.familiarFilter": "alpha,beta",
  });
  const newValues = { "board.viewMode": "gantt" };
  assert.equal({ ...legacy, ...newValues }["board.viewMode"], "gantt");
});

test("specs normalize allowed values and discard stale enum values", () => {
  assert.equal(surfacePreferenceSpecs.github.sortDir.parse("asc"), "asc");
  assert.equal(surfacePreferenceSpecs.github.sortDir.parse("sideways"), undefined);
  assert.equal(surfacePreferenceSpecs.calendar.viewMode.parse("month"), "month");
  assert.equal(surfacePreferenceSpecs.calendar.viewMode.parse("year"), undefined);
  assert.equal(surfacePreferenceSpecs.familiarMemory.staleOnly.parse(true), true);
  assert.equal(surfacePreferenceSpecs.familiarMemory.staleOnly.parse("true"), undefined);
});

test("every remounting surface opts into the registry while searches remain transient", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const sources = {
    github: read("../components/github-view.tsx"),
    board: read("../components/board-view.tsx"),
    schedules: read("../components/automations-view.tsx"),
    calendar: read("../components/calendar-view.tsx"),
    familiars: read("../components/familiars-view.tsx"),
    memory: read("../components/familiars-memory-view.tsx"),
    marketplace: read("../components/marketplace-view.tsx"),
    browser: read("../components/browser-pane.tsx"),
    grimoire: read("../components/grimoire-view.tsx"),
    workspace: read("../app/page.tsx"),
  };
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /useSurfacePreference|WorkspaceSurfacePreferencesProvider/, `${name} participates in workspace preferences`);
  }
  assert.match(sources.github, /const \[query, setQuery\] = useState\(""\)/, "GitHub search stays transient");
  assert.match(sources.memory, /const \[query, setQuery\] = useState\(""\)/, "Memory search stays transient");
  assert.match(sources.marketplace, /const \[query, setQuery\] = useState\(""\)/, "Marketplace search stays transient");
  assert.match(sources.github, /\(\) => deepLinkItem \?\? sorted\.find/, "an explicit GitHub deep link wins over restored selection");
  assert.match(sources.board, /const activeTab = deepLinkTab \?\? storedActiveTab/, "an explicit Board deep link wins without replacing the saved tab");
  assert.match(sources.grimoire, /useSurfacePreference\(surfacePreferenceSpecs\.grimoire\.selected\)/, "Grimoire restores its durable selected document through the registry");
  assert.match(sources.grimoire, /writeStoredTabs\(/, "Grimoire retains its existing resilient open-tab persistence");
  assert.match(sources.grimoire, /if \(deepLinkActiveRef\.current\) \{\s*deepLinkActiveRef\.current = false;/, "a one-visit Grimoire deep link yields to later user selections");
  assert.match(sources.grimoire, /restoredSelectionPendingRef\.current = true;/, "Grimoire marks a restored selection before persistence runs");
  assert.match(sources.grimoire, /if \(restoredSelectionPendingRef\.current\)/, "Grimoire waits to persist until a restored selection has been applied");
});

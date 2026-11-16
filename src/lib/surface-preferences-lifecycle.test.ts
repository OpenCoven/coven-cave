// @ts-nocheck — react-test-renderer has no bundled declarations.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement, StrictMode } from "react";
import { act, create } from "react-test-renderer";
import {
  SURFACE_PREFERENCES_STORAGE_KEY,
  WorkspaceSurfacePreferencesProvider,
  readSurfacePreferences,
  useSurfacePreference,
  writeSurfacePreferences,
} from "./surface-preferences.ts";
import { surfacePreferenceSpecs } from "./surface-preference-specs.ts";
import { useTrackedSurfaceValue } from "./use-surface-history.ts";
import { moveSurfaceHistory } from "./surface-history.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

for (const choice of [null, "memory", "sessions"]) {
  test(`Feed survives a reduced-profile visit and rollback${choice ? ` until explicit ${choice} selection` : ""}`, async () => {
    const values = new Map();
    const localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const initial = { "familiars.detailTab": "feed", "familiars.selectedId": "sage", "github.organization": "OpenCoven" };
    writeSurfacePreferences(localStorage, initial);
    const previousWindow = globalThis.window;
    globalThis.window = { localStorage };
    let current;
    let renderer;
    function Probe() {
      const [value, setValue, hydrated] = useSurfacePreference(surfacePreferenceSpecs.familiars.detailTab);
      const select = useTrackedSurfaceValue({ id: "test:detail-tab", value, onRestore: setValue });
      current = [value, select, hydrated];
      return null;
    }
    const render = () => createElement(StrictMode, null, createElement(WorkspaceSurfacePreferencesProvider, null, createElement(Probe)));
    try {
      await act(async () => { renderer = create(render()); });
      assert.equal(current[2], true, "exercise the real hydrated hook");
      assert.deepEqual(readSurfacePreferences(localStorage), initial, "mounting cannot rewrite the hidden choice or siblings");
      if (choice) {
        await act(async () => { current[1](choice); });
        assert.equal(readSurfacePreferences(localStorage)["familiars.detailTab"], choice);
        await act(async () => { assert.equal(moveSurfaceHistory(-1), true); });
        assert.equal(readSurfacePreferences(localStorage)["familiars.detailTab"], "feed", "Back retains the compatible hidden destination");
        await act(async () => { assert.equal(moveSurfaceHistory(1), true); });
      }
      await act(async () => { renderer.unmount(); });
      await act(async () => { renderer = create(render()); });
      assert.equal(current[0], choice ?? "feed", "a compatible client restores the retained value");
      assert.deepEqual(readSurfacePreferences(localStorage), { ...initial, "familiars.detailTab": choice ?? "feed" });
      assert.ok(values.has(SURFACE_PREFERENCES_STORAGE_KEY));
    } finally {
      await act(async () => { renderer?.unmount(); });
      globalThis.window = previousWindow;
    }
  });
}

test("the reduced panel projects the hidden preference without persisting that projection", () => {
  const source = readFileSync(new URL("../components/familiars-view-sections.tsx", import.meta.url), "utf8");
  assert.match(source, /const tab = storedTab === "feed" \? "memory" : storedTab/);
  assert.match(source, /id: "familiars:detail-tab",\s*value: storedTab/);
  assert.doesNotMatch(source, /setTab\("memory"\)/);
});

// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controller = await readFile(
  new URL("./remote-theme-controller.tsx", import.meta.url),
  "utf8",
);
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

assert.match(
  layout,
  /import \{ RemoteThemeController \} from "@\/components\/remote-theme-controller"/,
  "root layout imports the reconciliation controller",
);
assert.match(layout, /<RemoteThemeController \/>/, "reconciliation runs on every surface");

assert.match(controller, /subscribeAppPreferences\(reconcileCanonical\)/);
assert.match(
  controller,
  /function reconcileCanonical\(\)[\s\S]*themeRuntimeSignature\(theme, mode\)[\s\S]*data-theme[\s\S]*data-mode/,
  "canonical notifications reconcile the DOM without depending on selection revision",
);
assert.doesNotMatch(
  controller,
  /selectionRevision\s*[!=<>]=?[^\n]*reconcileCanonical/,
  "DOM reconciliation must not be gated on a selection revision change",
);

assert.match(controller, /matchMedia\("\(prefers-color-scheme: dark\)"\)/);
assert.match(controller, /colorScheme\.addEventListener\("change", onColorSchemeChange\)/);
assert.match(
  controller,
  /theme\.resolvedMode !== mode[\s\S]*updateAppPreferences\(\{ appearance: \{ theme: \{ resolvedMode: mode \} \} \}\)/,
  "an OS mode flip updates only derived resolvedMode",
);
assert.match(
  controller,
  /applyThemeToRoot\(html, theme, mode, lastAppliedCustom\)[\s\S]*lastAppliedCustom = theme\.id === "custom"[\s\S]*reapplyIndependentAppearance\(\{ preserveCustomDefaults: theme\.id === "custom" \}\)/,
  "theme changes clear the actually-applied custom palette and restore independent preferences",
);

assert.match(controller, /fetch\("\/api\/theme", \{ cache: "no-store" \}\)/);
assert.match(
  controller,
  /remoteThemeNeedsRefresh\(remote, local\)[\s\S]*refreshAppPreferences\(\)/,
  "polling treats the remote view as an invalidation signal, including same-selection mode changes",
);
assert.doesNotMatch(controller, /localStorage\.(?:getItem|setItem|removeItem)/);
assert.doesNotMatch(controller, /applyRemoteTheme|SYNCED_KEY/);

assert.match(
  controller,
  /await flushAppPreferences\(\)[\s\S]*generation !== publishGeneration[\s\S]*themeRuntimeSignature\(current, mode\) !== signature/,
  "publication is cancelled when a newer rendered selection wins during the flush",
);
assert.match(
  controller,
  /tokenOnly: true,[\s\S]*expectedSelectionRevision,[\s\S]*resolvedMode/,
  "phone token publication carries the current selection guard and resolved system mode",
);
assert.match(
  controller,
  /republishTokens\(current\.selectionRevision, mode\)/,
  "phone tokens are published against the post-flush canonical selection revision",
);
assert.match(controller, /res\.status === 409[\s\S]*refreshAppPreferences\(\)/);
assert.match(controller, /rgbaBytesToHex\(r, g, b, a\)/);

console.log("remote-theme-controller.test.ts: ok");

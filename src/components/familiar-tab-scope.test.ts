// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("Workspace threads the explicit scope and canonical mutation path to the Familiar tab", () => {
  assert.match(workspace, /selectedFamiliarIds=\{scopeIds\}/, "full scope reaches ChatSurface");
  assert.match(workspace, /onFamiliarScopeChange=\{selectFamiliarScope\}/, "Workspace remains the scope owner");
  assert.match(
    workspace,
    /opts\?: \{ multi\?: boolean; preserveSurface\?: boolean \}[\s\S]*?if \(opts\?\.multi \|\| opts\?\.preserveSurface\) return/,
    "intentional detail selection can preserve the current Familiar tab",
  );
  assert.match(surface, /selectedFamiliarIds=\{selectedFamiliarIds\}/, "scope reaches ChatFamiliarView");
  assert.match(surface, /familiarsLoaded=\{familiarsLoaded\}[\s\S]*?familiarsError=\{familiarsError\}/, "roster lifecycle reaches the tab");
  assert.match(surface, /onFamiliarScopeChange=\{onFamiliarScopeChange\}/, "canonical callback reaches the tab");
});

test("the view renders explicit lifecycle, scope, and unavailable states", () => {
  for (const kind of ["loading", "error", "empty", "unavailable", "all", "subset"]) {
    assert.match(view, new RegExp(`state\\.kind === "${kind}"`), `${kind} state rendered explicitly`);
  }
  assert.match(view, /state\.kind === "all" \|\| state\.kind === "subset"/, "all and subset share the overview");
  assert.match(
    view,
    /const detailFamiliar =\s*\(detailId \? selectableFamiliars\.find\(\(item\) => item\.id === detailId\) : null\) \?\? state\.familiar;/,
    "the detail defaults to the app-wide active familiar",
  );
  assert.match(view, /<FamiliarCapabilityPanel[\s\S]*?familiar=\{detailFamiliar\}/, "single state retains the capability panel");
  assert.doesNotMatch(view, /No familiar selected/, "nullable single-familiar copy is gone");
});

test("the roster rail browses locally — it never mutates the app-wide scope", () => {
  assert.match(view, /<FamiliarRosterRail/, "single state hosts the roster rail");
  assert.match(view, /storageKey="cave:familiar-tab:rail"/, "rail persists under its own key");
  assert.match(view, /placeholder="Search familiars…"/, "rail search follows placeholder grammar");
  assert.match(
    view,
    /item\.display_name\.toLowerCase\(\)\.includes\(needle\) \|\|\s*\(item\.role \?\? ""\)\.toLowerCase\(\)\.includes\(needle\)/,
    "search filters by name and role",
  );
  assert.match(view, /aria-current=\{item\.id === selectedId \? "true" : undefined\}/, "selected row announced with aria-current");
  assert.match(view, /onSelect=\{setDetailId\}/, "row activation only moves the local detail selection");
  const rail = view.slice(view.indexOf("function FamiliarRosterRail"), view.indexOf("// ── Surface"));
  assert.ok(rail.length > 0, "rail component located");
  assert.doesNotMatch(rail, /onFamiliarScopeChange/, "the rail cannot reach the scope mutation path");
  // A new app-wide selection re-anchors the local detail.
  assert.match(
    view,
    /useEffect\(\(\) => \{\s*setDetailId\(null\);\s*\}, \[activeFamiliarId\]\)/,
    "active familiar changes reset the local browse selection",
  );
  // Collapsed rail rows fall back to avatar-only buttons with tooltip names.
  assert.match(view, /title=\{open \? undefined : item\.display_name\}/, "collapsed rows keep tooltip names");
});

test("overview activation is the only action that narrows scope", () => {
  assert.match(
    view,
    /onSelect=\{\(id\) => onFamiliarScopeChange\(id, \{ preserveSurface: true \}\)\}/,
    "row activation intentionally selects one familiar without leaving the tab",
  );
  const overview = view.slice(view.indexOf("function FamiliarScopeOverview"), view.indexOf("function FamiliarCapabilityPanel"));
  assert.doesNotMatch(overview, /useEffect\([\s\S]*?onFamiliarScopeChange/, "mounting the overview never mutates scope");
});

test("overview is one accessible responsive list with one aggregate capability load", () => {
  assert.match(view, /role="list" aria-label=\{title\}/, "overview has a labelled list");
  assert.match(view, /role="listitem"[\s\S]*?<button[\s\S]*?aria-label=\{`View \$\{familiar\.display_name\} familiar details`\}/, "each entry keeps button semantics and an accessible label");
  assert.match(view, /const snapshot = useCapabilitySnapshot\(\)/, "overview performs one aggregate load");
  assert.doesNotMatch(view, /familiars\.map\([\s\S]{0,500}?<FamiliarCapabilityPanel/, "overview never mounts a full panel per familiar");
  assert.match(css, /@container \(max-width: 430px\)[\s\S]*?\.familiar-scope-overview__row/, "narrow panes get a container-driven layout");
  assert.match(css, /\.familiar-scope-overview__row \{[\s\S]*?min-height: 72px/, "row targets remain touch-sized");
});

test("the mobile tab strip scrolls independently without clipping trailing actions", () => {
  assert.match(
    surface,
    /className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden[^\"]*"/,
    "scope tabs own horizontal overflow instead of shifting the whole chat surface",
  );
  assert.match(
    surface,
    /<div className="flex shrink-0 items-center gap-1\.5">/,
    "group and code-rail actions stay inside the viewport",
  );
});

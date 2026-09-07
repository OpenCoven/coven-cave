// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const palette = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const chatSidebar = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const familiarsView = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");

/* ---------------------------------------------------------------------- */
/* Keyboard: Command/Control+Enter removes only implicit scopes            */
/* ---------------------------------------------------------------------- */

// The composer key handler routes Cmd/Ctrl+Enter to broadenGlobal, which
// sets global mode and drops implicit context scopes via broadenToGlobal.
assert.match(
  palette,
  /e\.key === "Enter" && \(e\.metaKey \|\| e\.ctrlKey\)[\s\S]{0,200}?broadenGlobal\(\)/,
  "Cmd/Ctrl+Enter broadens the search globally",
);
assert.match(
  palette,
  /broadenToGlobal\(effectiveState\)/,
  "broadening delegates to the canonical broadenToGlobal (explicit filters survive)",
);
assert.match(
  palette,
  /globalBroadened \? broadenToGlobal\(effectiveState\) : effectiveState/,
  "broaden state is applied to the request",
);

/* ---------------------------------------------------------------------- */
/* Keyboard: Backspace removes the final chip when free text is empty      */
/* ---------------------------------------------------------------------- */

assert.match(
  palette,
  /e\.key === "Backspace" && query === ""[\s\S]{0,120}?removeLastChip\(\)/,
  "Backspace with empty free text removes the final chip",
);
assert.match(
  palette,
  /const removeLastChip = \(\) => \{[\s\S]{0,400}?removeScopeChip\(last\.scope\)[\s\S]{0,200}?removeFilterChip\(last\.filter\)/,
  "chip removal handles both scopes and filters",
);

/* ---------------------------------------------------------------------- */
/* Transient typing + canonical URL sharing/restoration                    */
/* ---------------------------------------------------------------------- */

// Typing never touches history: the only history writes are replaceState
// calls inside the committed close path.
assert.doesNotMatch(palette, /pushState/, "typing never pushes browser history");
assert.match(
  palette,
  /window\.history\.replaceState\(null, "", url\.toString\(\)\)/,
  "a committed close serializes canonical query params",
);
assert.match(
  palette,
  /searchQueryToUrlString\(state\)/,
  "canonical ordered query parameters are serialized for the URL",
);

// Shared-link restoration: opening the palette reads search params and
// restores the same chips, text, and presentation.
assert.match(
  palette,
  /searchQueryFromUrlParams\(params\)/,
  "the palette restores query state from a shared link",
);
assert.match(
  palette,
  /setLinkState\(restorable \? restored : null\)/,
  "restored state becomes the effective query state",
);

// Copy search link is the explicit share affordance.
assert.match(
  palette,
  /navigator\.clipboard\.writeText\(url\)/,
  "Copy search link writes the canonical URL to the clipboard",
);
assert.match(palette, /Copy search link/, "the share action is visible");

/* ---------------------------------------------------------------------- */
/* Chips: visible implicit scopes and explicit filters with remove buttons */
/* ---------------------------------------------------------------------- */

assert.match(
  palette,
  /effectiveGlobalState\?\.scopes\.map/,
  "implicit context scopes render as chips",
);
assert.match(
  palette,
  /effectiveGlobalState\?\.filters\.map/,
  "explicit filters render as chips",
);
assert.match(
  palette,
  /Remove scope \$\{scope\.label\}/,
  "scope chips have specific accessible remove names",
);
assert.match(
  palette,
  /Remove filter \$\{chipLabelFor\(filter\)\}/,
  "filter chips have specific accessible remove names",
);

/* ---------------------------------------------------------------------- */
/* Implicit scope derivation from active workspace state                  */
/* ---------------------------------------------------------------------- */

assert.match(
  palette,
  /deriveImplicitScopes\(\{[\s\S]{0,300}?activeFamiliarId[\s\S]{0,200}?activeProjectId/,
  "implicit scopes derive from the active workspace state",
);

/* ---------------------------------------------------------------------- */
/* Coordinator results render as actionable rows                          */
/* ---------------------------------------------------------------------- */

assert.match(
  palette,
  /row\.kind === "search-result"[\s\S]{0,160}?open-href[\s\S]{0,120}?row\.result\.href/,
  "global results fire an in-app open-href intent",
);
assert.match(
  palette,
  /role="alert"[\s\S]{0,200}?globalError/,
  "provider failure is announced as an alert, not a status",
);
assert.match(
  palette,
  /globalLoading \? \([\s\S]{0,160}?role="status"/,
  "warming and summaries are status announcements",
);
assert.match(
  palette,
  /globalResults\.length[\s\S]{0,60}?result/,
  "result counts update live in a status region",
);

/* ---------------------------------------------------------------------- */
/* Relocation: workspace listens for the global-search request event       */
/* ---------------------------------------------------------------------- */

assert.match(
  workspace,
  /GLOBAL_SEARCH_REQUEST_EVENT, onGlobalSearchRequest/,
  "workspace listens for global-search requests",
);
assert.match(
  workspace,
  /setTopSearchQuery\(query\)/,
  "a request opens the palette with the preset query",
);
assert.match(
  workspace,
  /intent\.kind === "open-href"[\s\S]{0,120}?nextRouter\.push\(intent\.href\)/,
  "workspace navigates open-href intents",
);

/* ---------------------------------------------------------------------- */
/* Relocation: local filters use canonical Filter <items>… copy           */
/* ---------------------------------------------------------------------- */

assert.match(
  chatList,
  /placeholder="Filter sessions…"/,
  "chat list search narrows rendered data and says so (Filter sessions…)",
);
assert.match(
  chatList,
  /aria-label="Filter sessions"/,
  "chat list filter keeps a specific accessible name",
);
assert.match(
  chatList,
  /requestGlobalSearch\("type:chat"\)/,
  "chat search shortcut focuses global search with type:chat",
);
assert.match(
  chatSidebar,
  /placeholder="Filter chats…"/,
  "chat sidebar rail search uses canonical Filter copy",
);
assert.match(
  familiarsView,
  /placeholder="Filter familiars…"/,
  "familiar collection search uses canonical Filter copy",
);
assert.match(
  familiarsView,
  /requestGlobalSearch\("type:familiar"\)/,
  "familiar collection search can focus global search with type:familiar",
);

console.log("command-palette-global-search.test.ts: ok");

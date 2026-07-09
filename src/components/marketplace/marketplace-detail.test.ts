// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Marketplace prompt-pack previews + Try-it (cave-1f9h). The detail pane
// replaces bare template-id chips with real preview cards fetched from
// /api/marketplace/pack-prompts (works pre-install), and each card's "Try it"
// hands the body to the Home composer. Source pins — the fetch/render/nav
// wiring and the fallback that keeps the section from going blank.

const source = await readFile(new URL("./marketplace-detail.tsx", import.meta.url), "utf8");

// ── Previews replace bare ids ────────────────────────────────────────────────
assert.match(
  source,
  /<PackPromptPreviews pluginId=\{plugin\.id\} fallbackIds=\{plugin\.prompts\}/,
  "the prompt-templates section renders preview cards, not bare id chips",
);
assert.match(
  source,
  /fetch\(`\/api\/marketplace\/pack-prompts\?id=\$\{encodeURIComponent\(pluginId\)\}`/,
  "previews are fetched from the pack-prompts route (works pre-install)",
);
assert.match(source, /line-clamp-2/, "a two-line body snippet previews the template");
assert.match(source, /promptIconName\(p\.icon\)/, "card icons are validated against the curated set");
assert.match(
  source,
  /p\.tags\?\.length \?[\s\S]{0,200}?rounded-full/,
  "tags render as pills on the card",
);

// ── Fallback keeps the section from going blank ──────────────────────────────
assert.match(
  source,
  /if \(failed \|\| !prompts\?\.length\) \{[\s\S]{0,400}?fallbackIds\.map/,
  "a failed fetch falls back to the bare catalog ids (never a blank section)",
);

// ── Try it → Home composer draft + navigate ──────────────────────────────────
assert.match(
  source,
  /writeComposerDraft\(HOME_DRAFT_KEY, body\)/,
  "Try it writes the template body into the Home composer draft slot",
);
assert.match(
  source,
  /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: "home" \} \}\)/,
  "Try it navigates Home so the placeholder Tab flow picks up on arrival",
);
assert.match(
  source,
  /onClick=\{\(\) => onTry\(p\.body\)\}\s*>\s*Try it/,
  "each preview card exposes a Try it action bound to its body",
);
// Visibility (user feedback): the Try it action is a bordered secondary button
// with a directional icon — not the near-invisible ghost it started as.
assert.match(
  source,
  /variant="secondary"[\s\S]{0,120}?trailingIcon="ph:arrow-right-bold"[\s\S]{0,160}?Try it/,
  "Try it is a visible secondary button with a hand-off arrow (not a ghost)",
);
assert.match(
  source,
  /onClose\(\);/,
  "Try it closes the detail before navigating",
);

// ── Route reuses the shared catalog resolver ─────────────────────────────────
const route = await readFile(new URL("../../app/api/marketplace/pack-prompts/route.ts", import.meta.url), "utf8");
assert.match(route, /resolveCatalogName\(id\)/, "the route resolves the id against the catalog allowlist");
assert.match(route, /pluginDir\(name\)/, "the scan path is built from the resolved name, not the request id");

// The install route now shares that resolver instead of its own copy.
const install = await readFile(new URL("../../app/api/marketplace/install/route.ts", import.meta.url), "utf8");
assert.match(
  install,
  /import \{ resolveCatalogPlugin \} from "@\/lib\/server\/marketplace-catalog-resolve"/,
  "install route reuses the extracted resolver (single allowlist source)",
);
assert.doesNotMatch(install, /async function resolveCatalogName/, "install route no longer defines its own resolver copy");

console.log("marketplace-detail.test.ts: ok");

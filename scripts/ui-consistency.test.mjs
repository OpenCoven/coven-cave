import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";

function exactHeadingPattern(heading) {
  const escapedHeading = heading.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedHeading}$`, "m");
}

const designLanguage = readFileSync(
  new URL("../docs/coven-design-language.md", import.meta.url),
  "utf8",
);

assert.match(
  designLanguage,
  /Section 10 is authoritative for interface language/,
  "Section 10 is the interface language authority",
);

const vocabularyHeading = exactHeadingPattern("### Vocabulary");
assert.match(
  "### Vocabulary",
  vocabularyHeading,
  "exact heading matcher accepts the intended heading",
);
assert.doesNotMatch(
  "#### Vocabulary",
  vocabularyHeading,
  "exact heading matcher rejects demoted headings",
);
assert.doesNotMatch(
  "### Vocabulary and tone",
  vocabularyHeading,
  "exact heading matcher rejects suffixed headings",
);

for (const heading of [
  "## 10. Interface copy and field contract",
  "### Vocabulary",
  "### Action copy",
  "### Field semantics",
  "### Placeholder grammar",
  "### State copy",
]) {
  assert.match(
    designLanguage,
    exactHeadingPattern(heading),
    `design language contains ${heading}`,
  );
}

assert.match(
  designLanguage,
  /\*\*Tasks\*\* is the top-level user-facing noun/,
  "Tasks is the canonical destination noun",
);
assert.match(
  designLanguage,
  /A\s+placeholder\s+never\s+replaces\s+a\s+persistent\s+label/,
  "placeholder-only labeling is forbidden",
);
assert.match(
  designLanguage,
  /`Search <items>…`/,
  "search placeholder grammar is explicit",
);
assert.match(
  designLanguage,
  /\*\*Couldn't load <object>\*\*/,
  "failure grammar names the failed object",
);

// ── fact pins: the design doc must match the shipped code ──────────────────
// docs/coven-design-language.md quotes token values, palette counts, and file
// paths from the codebase. These pins fail CI when a refactor or retune makes
// the doc lie, so drift gets reconciled instead of accumulating (the doc
// carried a full palette's worth of stale values before cave-kf3x).

const repoRoot = new URL("../", import.meta.url);
const foundations = readFileSync(
  new URL("src/styles/globals/foundations.css", repoRoot),
  "utf8",
);
const agentsNotes = readFileSync(new URL("AGENTS.md", repoRoot), "utf8");

/** First definition wins = the :root dark value. */
function tokenValue(css, name) {
  const m = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"));
  assert.ok(m, `foundations.css defines ${name}`);
  return m[1].trim();
}

/** Same lookup, scoped to the light-mode override block. */
function lightTokenValue(css, name) {
  const lightStart = css.indexOf(':root[data-mode="light"]');
  assert.ok(lightStart > 0, "foundations.css has the light-mode override");
  return tokenValue(css.slice(lightStart), name);
}

// 1. Every repo path the doc cites exists (line-number suffixes stripped;
//    glob patterns skipped). Citations must not point at deleted/renamed files.
for (const [, cited] of designLanguage.matchAll(/`((?:src|docs|scripts)\/[^`\s]+)`/g)) {
  if (cited.includes("*")) continue;
  const bare = cited.replace(/:[\d-]+$/, "");
  assert.ok(
    existsSync(new URL(bare, repoRoot)),
    `design doc cites ${cited}, but ${bare} does not exist — update the citation`,
  );
}

// 2. No line-number citations into the old globals.css monolith — the file is
//    an import facade now, and bare `globals.css:N` references rot silently.
assert.doesNotMatch(
  designLanguage,
  /`globals\.css:\d/,
  "cite src/styles/globals/* files, not line offsets into the globals.css facade",
);

// 3. Palette count: the doc and AGENTS.md state the number that
//    src/lib/theme-palettes.ts actually ships.
const themeIdsSource = readFileSync(new URL("src/lib/theme-palettes.ts", repoRoot), "utf8");
const themeIdsBlock = themeIdsSource.match(/THEME_IDS = \[([\s\S]*?)\] as const/);
assert.ok(themeIdsBlock, "theme-palettes.ts declares THEME_IDS");
const paletteCount = (themeIdsBlock[1].match(/"[a-z0-9-]+"/g) ?? []).length;
assert.ok(paletteCount >= 16, "sanity: palette roster parsed");
assert.match(
  designLanguage,
  new RegExp(`every one of the ${paletteCount} theme\\s+palettes`),
  `doc §1 states the shipped palette count (${paletteCount})`,
);
assert.match(
  designLanguage,
  new RegExp(`\\(${paletteCount} palettes:`),
  `doc §2 theming lists the shipped palette count (${paletteCount})`,
);
assert.match(
  designLanguage,
  new RegExp(`${paletteCount * 2} palette×mode combinations`),
  "doc §2 derives the combination count from the roster",
);
assert.ok(
  agentsNotes.includes(`${paletteCount} palettes × 2 modes`),
  `AGENTS.md design-system section states the shipped palette count (${paletteCount})`,
);

// 4. Quoted token values match the live token contract.
for (const [token, docAlias] of [
  ["--bg-panel", "--bg-panel"],
  ["--background", "--bg-base"],
  ["--card", "--bg-raised"],
  ["--bg-elevated", "--bg-elevated"],
  ["--bg-hover", "--bg-hover"],
  ["--code-surface", "--code-surface"],
  ["--muted-foreground", "--text-secondary"],
]) {
  const value = tokenValue(foundations, token);
  assert.ok(
    designLanguage.includes(`\`${value}\``),
    `doc quotes ${docAlias} as a stale value — foundations.css now defines ${token}: ${value}`,
  );
}

const accentDark = tokenValue(foundations, "--accent-presence");
const accentLight = lightTokenValue(foundations, "--accent-presence");
assert.ok(
  designLanguage.toLowerCase().includes(accentDark.toLowerCase()),
  `doc states the dark accent hex (${accentDark})`,
);
assert.ok(
  designLanguage.toLowerCase().includes(accentLight.toLowerCase()),
  `doc states the light accent hex (${accentLight})`,
);

const mutedPct = (css) => {
  const m = tokenValue(css, "--text-muted").match(/(\d+)%/);
  assert.ok(m, "--text-muted is a percentage mix");
  return m[1];
};
assert.ok(
  designLanguage.includes(`${mutedPct(foundations)}%, transparent`),
  `doc states the dark --text-muted mix (${mutedPct(foundations)}%)`,
);
const lightSlice = foundations.slice(foundations.indexOf(':root[data-mode="light"]'));
assert.ok(
  designLanguage.includes(`${mutedPct(lightSlice)}% light`),
  `doc states the light --text-muted mix (${mutedPct(lightSlice)}%)`,
);

const strongPct = (css) => {
  const m = tokenValue(css, "--border-strong").match(/(\d+)%/);
  assert.ok(m, "--border-strong is a percentage mix");
  return m[1];
};
assert.ok(
  designLanguage.includes(`${strongPct(foundations)}% dark / ${strongPct(lightSlice)}% light`),
  `doc states the --border-strong mixes (${strongPct(foundations)}/${strongPct(lightSlice)})`,
);

// 5. Icon-count claim stays within 15% of the real ICON_NAMES roster.
const iconSource = readFileSync(new URL("src/lib/icon.tsx", repoRoot), "utf8");
const iconBlock = iconSource.match(/ICON_NAMES = \[([\s\S]*?)\] as const/);
assert.ok(iconBlock, "icon.tsx declares ICON_NAMES");
const iconCount = (iconBlock[1].match(/"ph:[a-z0-9-]+"/g) ?? []).length;
const iconClaim = designLanguage.match(/\(~(\d+) icons\)/);
assert.ok(iconClaim, "doc §5 states an approximate icon count");
assert.ok(
  Math.abs(Number(iconClaim[1]) - iconCount) / iconCount <= 0.15,
  `doc §5 claims ~${iconClaim[1]} icons but ICON_NAMES has ${iconCount} — refresh the claim`,
);

// 6. Agent entry points keep pointing at the design system.
assert.match(
  agentsNotes,
  /^## Design System \(any UI work\)$/m,
  "AGENTS.md keeps the design-system section",
);
assert.ok(
  agentsNotes.includes("docs/coven-design-language.md"),
  "AGENTS.md links the design-language contract",
);
assert.ok(
  agentsNotes.includes("src/lib/design-token-drift.test.ts"),
  "AGENTS.md names the drift-ratchet gate",
);

console.log(
  `ui-consistency.test.mjs: copy contract ok; fact pins ok (${paletteCount} palettes, ${iconCount} icons)`,
);

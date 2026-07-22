// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab — Identity section (skills-page design handoff, cave-moig).
// Pins the honesty rules of the profile tab: only real Familiar fields render
// as facts (the design mock's "Summoned"/lifetime-session numbers have no
// backing field and must stay out), the Identity contract card renders the
// real adherence scan rather than a hardcoded file list, roles expand
// accessibly, and the profile drill-through from the old hero survives.

const src = readFileSync(new URL("./familiar-tab-identity.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab-identity.css", import.meta.url), "utf8");

test("no fabricated facts: Summoned / lifetime session counts are omitted, real facts are gated", () => {
  assert.doesNotMatch(src, /label="Summoned"|>Summoned</, "no Summoned fact — creation date does not exist on the Familiar record");
  assert.doesNotMatch(src, /\b132\b/, "no hardcoded session count from the design mock");
  assert.match(
    src,
    /typeof familiar\.active_sessions === "number" && familiar\.active_sessions > 0/,
    "active-sessions fact renders only when the real field is set and positive",
  );
  assert.match(src, /familiar\.pronouns \? <Fact label="Pronouns"/, "pronouns fact is gated on the real field");
  assert.match(
    src,
    /familiar\.last_seen \? relativeTime\(familiar\.last_seen\)/,
    "last-seen renders through the shared relativeTime formatter",
  );
});

test("about card: description empty state and profile drill-through are preserved", () => {
  assert.match(
    src,
    /openFamiliarStudioSettingsTab\("identity", familiar\.id\)/,
    "empty description CTA opens the Studio identity tab",
  );
  assert.match(
    src,
    /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/profile`\}/,
    "Profile → drill-through from the old hero is preserved",
  );
  assert.match(src, /from "next\/link"/, "profile link is a client-side Link");
});

test("runtime card: real adapter facts with scan freshness, binary path demoted to tooltip", () => {
  assert.match(
    src,
    /manifest\?\.scanned_at \? relativeTime\(manifest\.scanned_at\)/,
    "scan freshness comes from the real manifest timestamp",
  );
  assert.match(
    src,
    /harnessReport\.label\}\$\{harnessReport\.version \? ` \$\{harnessReport\.version\}` : ""/,
    "runtime label+version come from the adapter report",
  );
  assert.match(
    src,
    /<Fact label="Binary" value=\{harnessReport\.path\} mono title=\{harnessReport\.path\} \/>/,
    "binary is mono + truncated with the full path in the tooltip",
  );
  assert.match(src, /familiar\.model \? <Fact label="Model" value=\{familiar\.model\} mono \/>/, "model fact gated on the real binding");
});

test("voice card: bound marker is neutral, unset state gets a Studio brain CTA", () => {
  assert.match(src, /getVoiceProvider\(familiar\.voiceProvider\)\?\.label/, "provider label resolves through the voice registry");
  assert.match(
    src,
    /label="Choose a voice"[\s\S]{0,120}?openFamiliarStudioSettingsTab\("brain", familiar\.id\)/,
    "no-voice CTA opens the Studio brain tab",
  );
  const voicePill = src.slice(src.indexOf("familiar-identity__voice-pill"), src.indexOf("familiar-identity__voice-pill") + 120);
  assert.doesNotMatch(voicePill, /accent-presence|true voice/, "bound marker stays a neutral chip, accent reserved for presence");
});

test("roles rows are expandable and keyboard-honest: aria-expanded + focus ring + caret state", () => {
  assert.match(src, /aria-expanded=\{open\}/, "role rows announce their expanded state");
  assert.match(src, /className="familiar-tab__row-toggle focus-ring"/, "row toggles carry the shared focus ring");
  assert.match(src, /data-open=\{open\}/, "caret rotation is state-driven");
  assert.match(css, /\.familiar-identity__caret\[data-open="true"\] \{[^}]*rotate\(90deg\)/, "caret rotates via CSS transform");
  assert.match(src, /\{role\.skills\.length\} skill\{role\.skills\.length === 1 \? "" : "s"\}/, "meta counts the role's real skill grants");
  assert.match(src, /role\.skills\.map\(\(sid\)/, "expanded rows list the role's real skill ids as chips");
});

test("roles header pill is success-tinted and count-honest; empty state routes to roles", () => {
  assert.match(src, /\{roles\.length\} active/, "pill shows the real active-role count");
  assert.match(
    css,
    /\.familiar-identity__pill--active \{[^}]*color-mix\(in oklch, var\(--color-success\) 14%, transparent\)/,
    "success tint recipe (14% fill)",
  );
  assert.match(
    src,
    /label="Open roles →" onClick=\{\(\) => navigateFamiliarSurface\("roles"\)\}/,
    "empty roles CTA rides the shared navigate event",
  );
});

test("identity contract card scans for real: fetches the contract route, renders fetched statuses only", () => {
  assert.match(
    src,
    /fetch\(`\/api\/familiars\/\$\{encodeURIComponent\(familiarId\)\}\/contract`/,
    "card fetches the real adherence report",
  );
  assert.match(src, /const present = contract\.present\[key\];/, "per-file found/missing comes from the fetched report");
  assert.match(
    src,
    /contract\.status === "loading" \?[\s\S]{0,200}?Checking the contract…/,
    "file rows are withheld while the scan is in flight",
  );
  assert.match(
    src,
    /contract\.status === "error" \?[\s\S]{0,200}?Contract check unavailable\./,
    "fetch failure is stated honestly instead of faking statuses",
  );
  assert.match(src, /name: "MEMORY\.md"/, "memory row names the real v0.1.0 file, not the mock's memory/ directory");
  assert.doesNotMatch(src, /"memory\/"/, "no fabricated memory/ row");
  assert.match(
    src,
    /openFamiliarStudioSettingsTab\("contract", familiar\.id\)/,
    "card links through to the Studio contract tab",
  );
  assert.match(
    src,
    /contract\.report\.violations\.length\} violation/,
    "non-compliance pill counts the report's real violations",
  );
  // Violations spanning files carry file: "cross-file"; they count in the
  // pill, so they must also be locatable in the file list (PR #3655 follow-up).
  assert.match(src, /v\.file === "cross-file"/, "cross-file violations are collected");
  assert.match(src, /cross-file[\s\S]{0,400}?\{crossFile\[0\]\.message\}/, "cross-file row surfaces the first message as its blurb");
});

test("identity CSS is component-owned: BEM prefix, tokens only, container-query collapse", () => {
  assert.match(src, /import "@\/styles\/familiar-tab-identity\.css"/, "CSS ships with the component, not globals");
  assert.match(css, /@container \(min-width: 840px\) \{[\s\S]{0,200}?minmax\(0, 1\.2fr\) minmax\(0, 1fr\)/, "1.2fr/1fr grid at the shared 840px breakpoint");
  const classDefs = css.match(/^\.[a-z-]+[a-z_-]*/gm) ?? [];
  for (const def of classDefs) {
    assert.ok(def.startsWith(".familiar-identity__"), `new selectors stay under the familiar-identity__ prefix (got ${def})`);
  }
  assert.doesNotMatch(css, /:\s*[^;{}]*#[0-9a-fA-F]{3,8}\b/, "no hardcoded hex colors in declarations — tokens only (16 themes × dark/light)");
});

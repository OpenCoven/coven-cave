// @ts-nocheck
import assert from "node:assert/strict";
import {
  inferGlyphFromRole,
  resolveFamiliarGlyph,
  DEFAULT_FAMILIAR_GLYPH,
  ROLE_GLYPH_MAP,
} from "./familiar-glyph.ts";
import phGlyphs from "./ph-familiar-core.json" with { type: "json" };

// Regression guard: every built-in glyph name (role-map + default) MUST exist
// in the bundled catalog, or it renders an empty glyph. This is exactly how
// `ph:code-bold` slipped in — the catalog only ships the `-fill` variant.
{
  const bundled = new Set(Object.keys(phGlyphs.icons ?? {}).map((n) => `ph:${n}`));
  const builtIns = [...ROLE_GLYPH_MAP.map(([, name]) => name), DEFAULT_FAMILIAR_GLYPH.name];
  for (const name of builtIns) {
    assert.ok(bundled.has(name), `built-in glyph "${name}" missing from ph-familiar-core.json (would render blank)`);
  }
}

// inferGlyphFromRole — keyword matches
{
  assert.equal(inferGlyphFromRole("Code Reviewer")?.name, "ph:code-fill");
  assert.equal(inferGlyphFromRole("chat host")?.name, "ph:chat-circle-fill");
  assert.equal(inferGlyphFromRole("Music critic")?.name, "ph:music-notes-fill");
  assert.equal(inferGlyphFromRole("research librarian")?.name, "ph:books-fill");
  assert.equal(inferGlyphFromRole("Art director")?.name, "ph:palette-fill");
  assert.equal(inferGlyphFromRole("Data scientist")?.name, "ph:chart-bar-fill");
  assert.equal(inferGlyphFromRole("OPS engineer")?.name, "ph:gear-fill");
  assert.equal(inferGlyphFromRole("Writer")?.name, "ph:pencil-fill");
  assert.equal(inferGlyphFromRole("Designer")?.name, "ph:pen-nib-fill");
}

// inferGlyphFromRole — no match returns null
{
  assert.equal(inferGlyphFromRole("Spelunker"), null);
  assert.equal(inferGlyphFromRole(""), null);
  assert.equal(inferGlyphFromRole("  "), null);
}

// resolveFamiliarGlyph — new precedence step
{
  // No override / icon / emoji — should fall through to role inference.
  const fam = { id: "x", role: "code reviewer" } as any;
  assert.equal(resolveFamiliarGlyph(fam, {}).name, "ph:code-fill");
}

{
  // Override still wins over role inference.
  const fam = { id: "x", role: "code reviewer" } as any;
  assert.equal(
    resolveFamiliarGlyph(fam, { x: "ph:cat-fill" }).name,
    "ph:cat-fill",
  );
}

{
  // Daemon icon still wins over role inference.
  const fam = { id: "x", role: "code reviewer", icon: "ph:wand-fill" } as any;
  assert.equal(resolveFamiliarGlyph(fam, {}).name, "ph:wand-fill");
}

{
  // No override, no icon, no emoji, role doesn't match — final default fires.
  const fam = { id: "x", role: "spelunker" } as any;
  assert.equal(resolveFamiliarGlyph(fam, {}).name, DEFAULT_FAMILIAR_GLYPH.name);
}

// inferGlyphFromRole — word-boundary discipline
{
  // 'art' must NOT match 'chart' or 'smart'
  assert.equal(inferGlyphFromRole("Chart analyst"), null);
  assert.equal(inferGlyphFromRole("Smartbot"), null);
  // 'data' must NOT match 'update' or 'validator'
  assert.equal(inferGlyphFromRole("Update wizard"), null);
  // 'art' does not match 'artist' — no word boundary after 'art' in 'artist'
  assert.equal(inferGlyphFromRole("artist in residence"), null);
  // But standalone 'Art' at the start of a word does match
  assert.equal(inferGlyphFromRole("Art curator")?.name, "ph:palette-fill");
  assert.equal(inferGlyphFromRole("data scientist")?.name, "ph:chart-bar-fill");
}

// resolveFamiliarGlyph — daemon emoji (step 3) beats role inference (step 4)
{
  const fam = { id: "x", role: "code reviewer", emoji: "ph:cat-fill" } as any;
  assert.equal(resolveFamiliarGlyph(fam, {}).name, "ph:cat-fill");
}

console.log("familiar-glyph.test.ts: ok");

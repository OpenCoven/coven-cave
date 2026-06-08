// @ts-nocheck
import assert from "node:assert/strict";
import {
  inferGlyphFromRole,
  resolveFamiliarGlyph,
  DEFAULT_FAMILIAR_GLYPH,
} from "./familiar-glyph.ts";

// inferGlyphFromRole — keyword matches
{
  assert.equal(inferGlyphFromRole("Code Reviewer")?.name, "ph:code-bold");
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
  assert.equal(resolveFamiliarGlyph(fam, {}).name, "ph:code-bold");
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

console.log("familiar-glyph.test.ts: ok");

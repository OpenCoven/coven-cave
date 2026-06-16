// @ts-nocheck
import assert from "node:assert/strict";
import { resolveFamiliar } from "./familiar-resolve.ts";
import { DEFAULT_FAMILIAR_GLYPH } from "./familiar-glyph.ts";

const base = {
  id: "cody",
  display_name: "Cody",
  role: "Code Reviewer",
  description: "A friendly bot",
  pronouns: "they/them",
  icon: "ph:wand-fill",
};

// No overrides → daemon values + inferred color fallback
{
  const r = resolveFamiliar(base, { archived: false });
  assert.equal(r.display_name, "Cody");
  assert.equal(r.role, "Code Reviewer");
  assert.equal(r.pronouns, "they/them");
  assert.equal(r.description, "A friendly bot");
  assert.equal(r.color, "var(--accent-presence)");
  assert.equal(r.avatarImage, undefined);
  assert.equal(r.glyph.name, "ph:wand-fill");
  assert.equal(r.archived, false);
}

// Override wins over daemon
{
  const r = resolveFamiliar(base, {
    override: { display_name: "Cody the Brave", color: "#ff6600" },
    archived: false,
  });
  assert.equal(r.display_name, "Cody the Brave");
  assert.equal(r.role, "Code Reviewer"); // not overridden
  assert.equal(r.color, "#ff6600");
}

// Saved Cave config color wins over the default when no local override is present
{
  const r = resolveFamiliar({ ...base, color: "#123456" }, { archived: false });
  assert.equal(r.color, "#123456");
}

// Image present
{
  const r = resolveFamiliar(base, {
    image: { dataUrl: "data:image/png;base64,AAA", mime: "image/png", updatedAt: "2026-06-08T00:00:00Z" },
    archived: false,
  });
  assert.equal(r.avatarImage, "data:image/png;base64,AAA");
  // Glyph still resolved for fallback
  assert.equal(r.glyph.name, "ph:wand-fill");
}

// Glyph override wins
{
  const r = resolveFamiliar(base, { glyphOverride: "ph:cat-fill", archived: false });
  assert.equal(r.glyph.name, "ph:cat-fill");
}

// No icon / override → role inference
{
  const noIcon = { ...base, icon: undefined };
  const r = resolveFamiliar(noIcon, { archived: false });
  assert.equal(r.glyph.name, "ph:code-bold");
}

// No icon, no role match → DEFAULT_FAMILIAR_GLYPH
{
  const exotic = { ...base, icon: undefined, role: "Spelunker" };
  const r = resolveFamiliar(exotic, { archived: false });
  assert.equal(r.glyph.name, DEFAULT_FAMILIAR_GLYPH.name);
}

// archived flag passes through
{
  const r = resolveFamiliar(base, { archived: true });
  assert.equal(r.archived, true);
}

console.log("familiar-resolve.test.ts: ok");

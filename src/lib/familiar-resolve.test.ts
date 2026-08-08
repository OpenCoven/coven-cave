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
  // Upload-only: no second source to fall back through.
  assert.equal(r.avatarImageFallback, undefined);
}

// Workspace avatar present: it's the primary image source.
{
  const r = resolveFamiliar(
    { ...base, avatarUrl: "/api/familiars/x/avatar?v=1" },
    { archived: false },
  );
  assert.equal(r.avatarImage, "/api/familiars/x/avatar?v=1");
  assert.equal(r.avatarImageFallback, undefined, "no upload → no fallback source");
}

// BOTH a workspace avatar AND a Cave-local upload: the most recently written
// one is primary and the other remains available as fallback.
const UPLOAD = "data:image/png;base64,AAA";
const upload = (updatedAt) => ({ dataUrl: UPLOAD, mime: "image/png", updatedAt });

// Newer Cave-local upload wins.
{
  const r = resolveFamiliar(
    { ...base, avatarUrl: "/api/familiars/x/avatar?v=1" },
    { image: upload("2026-06-08T00:00:00Z"), archived: false },
  );
  assert.equal(r.avatarImage, UPLOAD);
  assert.equal(r.avatarImageFallback, "/api/familiars/x/avatar?v=1");
}

// Newer workspace avatar wins.
{
  const v = String(Date.parse("2026-07-01T00:00:00Z"));
  const r = resolveFamiliar(
    { ...base, avatarUrl: `/api/familiars/x/avatar?v=${v}&format=png` },
    { image: upload("2026-06-08T00:00:00Z"), archived: false },
  );
  assert.equal(r.avatarImage, `/api/familiars/x/avatar?v=${v}&format=png`);
  assert.equal(r.avatarImageFallback, UPLOAD);
}

// An undatable upload never displaces a datable workspace avatar.
{
  const r = resolveFamiliar(
    { ...base, avatarUrl: "/api/familiars/x/avatar?v=999" },
    { image: upload("not a date"), archived: false },
  );
  assert.equal(r.avatarImage, "/api/familiars/x/avatar?v=999");
  assert.equal(r.avatarImageFallback, UPLOAD);
}

// A datable upload displaces an undatable workspace avatar.
{
  const r = resolveFamiliar(
    { ...base, avatarUrl: "/api/familiars/x/avatar" },
    { image: upload("2026-06-08T00:00:00Z"), archived: false },
  );
  assert.equal(r.avatarImage, UPLOAD);
  assert.equal(r.avatarImageFallback, "/api/familiars/x/avatar");
}

// Neither source is datable, so the historic workspace-first order stands.
{
  const r = resolveFamiliar(
    { ...base, avatarUrl: "/api/familiars/x/avatar" },
    { image: upload("nonsense"), archived: false },
  );
  assert.equal(r.avatarImage, "/api/familiars/x/avatar");
  assert.equal(r.avatarImageFallback, UPLOAD);
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
  assert.equal(r.glyph.name, "ph:code-fill");
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

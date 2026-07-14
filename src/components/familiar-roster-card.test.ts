// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");
const card = source.match(/function FamiliarRosterCard[\s\S]*?\n\}\n/)?.[0] ?? "";

assert.ok(card.length > 0, "FamiliarRosterCard function should be present in familiars-view.tsx");

assert.match(card, /aria-label=\{`Open \$\{familiar\.display_name\}`\}/, "Card has accessible label naming the familiar");

assert.match(
  card,
  /<FamiliarAvatar familiar=\{familiar\} size="sm" \/>/,
  "Card renders the shared FamiliarAvatar so uploaded images win over glyph fallback",
);

assert.match(card, /familiar\.display_name/, "Card shows display name");
assert.match(card, /familiar\.role \|\| familiar\.harness \|\| familiar\.id/, "Card shows role / harness / id fallback chain");

assert.match(
  card,
  /daemonRunning \? "online" : "offline"/,
  "Status row shows online/offline tied to daemonRunning",
);

assert.match(
  card,
  /stats\.hasActiveSession \?[\s\S]*active session/,
  "Active-session pill rendered when stats.hasActiveSession",
);

assert.match(
  card,
  /responseNeeded \?[\s\S]*response needed/,
  "Response-needed chip rendered when responseNeeded",
);

assert.match(card, /No sessions yet/, "Activity line handles zero-session case");
assert.match(card, /this week/, "Activity line shows sessionsLast7d label");

assert.match(
  card,
  /memoryStatus === "loading"[\s\S]*<Skeleton variant="text-sm"/,
  "Memory snapshot shimmers (shared Skeleton) while the fetch is in flight — no dead 'Loading memory…' text (cave-5qmm)",
);

// De-boxed card contracts (cave-g2r6): wrapper owns the wash/hairline visual
// so the open button and the analytics link are sibling controls inside it —
// the link no longer floats orphaned outside the card boundary.
assert.match(
  card,
  /className="familiars-view__card group relative flex h-full flex-col"/,
  "The wrapper div carries the card visual (wash + soft hairline via CSS)",
);
assert.doesNotMatch(
  card,
  /border border-\[var\(--border-hairline\)\] bg-\[var\(--bg-raised\)\]/,
  "The open button no longer draws its own hard border box",
);
assert.match(
  card,
  /familiars-view__card-footer[\s\S]*Analytics →/,
  "The analytics link is folded into the card footer",
);
assert.match(
  card,
  /<Link[\s\S]{0,400}className="focus-ring[\s\S]{0,200}Analytics →/,
  "The footer analytics link is keyboard-focusable with the shared focus ring",
);
assert.match(
  card,
  /title=\{stats\.latestMemory\?\.title\}/,
  "The latest memory title survives as the one-liner's tooltip",
);

assert.match(
  card,
  /memoryStatus === "error"[\s\S]*Memory unavailable/,
  "Memory snapshot falls back to 'Memory unavailable' when memory feed errored",
);

assert.match(
  card,
  /No memories yet/,
  "Memory snapshot shows 'No memories yet' for zero-memory familiars in the ready state",
);

assert.match(
  card,
  /stats\.memoryCount === 1 \? "y" : "ies"/,
  "Memory count pluralization is correct",
);

assert.match(
  card,
  /stats\.latestMemory\?\.title|stats\.latestMemory\.title/,
  "Latest memory title is preserved (tooltip on the one-liner)",
);

// CSS contracts for the de-boxed card.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(
  css,
  /\.familiars-view__card \{[\s\S]{0,400}?box-shadow: inset 0 0 0 1px color-mix\(in oklch, var\(--border-hairline\) 55%, transparent\);/,
  "Card hairline is a soft inset wash, not a hard border",
);
assert.match(
  css,
  /\.familiars-view__card:hover \{[\s\S]{0,400}?transform: translateY\(-1px\);/,
  "Hover gives a quiet lift",
);
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.familiars-view__card,\s*\n\s*\.familiars-view__card:hover \{\s*\n\s*transform: none;/,
  "The hover lift is removed under prefers-reduced-motion",
);

console.log("familiar-roster-card: all assertions passed");

// @ts-nocheck
import assert from "node:assert/strict";
import { stripMdxLeakage } from "./strip-mdx.ts";

// <Cards>/<Card /> → markdown link list.
{
  const out = stripMdxLeakage([
    "<Cards>",
    "  <Card title=\"Getting Started\" href=\"/docs/guide/getting-started\" description=\"Set up your first familiar.\" />",
    "  <Card title=\"Concepts\" href=\"/docs/guide/concepts\" />",
    "</Cards>",
  ].join("\n"));
  assert.match(out, /- \[Getting Started\]\(\/docs\/guide\/getting-started\) — Set up your first familiar\./);
  assert.match(out, /- \[Concepts\]\(\/docs\/guide\/concepts\)/);
  assert.doesNotMatch(out, /<Cards>/);
  assert.doesNotMatch(out, /<Card\s/);
}

// <Mermaid …multi-line chart…/> wholesale strip — including arrows that
// contain `>` (`-->`) inside the quoted chart attribute, which the previous
// `[^<>]` regex stopped at and leaked the rest of the chart body.
{
  const out = stripMdxLeakage([
    "## Architecture",
    "<Mermaid",
    "  chart=\"`",
    "flowchart LR",
    "  UI[CastCodes UI] --> Agent[Cast Agent\\nsubstrate + session backend]",
    "  Agent --> Gateway[Coven Gateway]",
    "`\"",
    "/>",
    "Some prose after.",
  ].join("\n"));
  assert.doesNotMatch(out, /<Mermaid/);
  assert.doesNotMatch(out, /flowchart LR/);
  assert.doesNotMatch(out, /chart=/);
  assert.doesNotMatch(out, /Cast Agent\\nsubstrate/, "no chart body residue must survive past the `-->` arrows");
  assert.doesNotMatch(out, /Coven Gateway/);
  assert.match(out, /## Architecture/);
  assert.match(out, /Some prose after\./);
}

// <DocsDataTable> with multi-line array attributes.
{
  const out = stripMdxLeakage([
    "<DocsDataTable",
    "  caption=\"Coven differentiators\"",
    "  columns=\"[ { key: 'pillar' } ]\"",
    "/>",
    "Trailing prose.",
  ].join("\n"));
  assert.doesNotMatch(out, /<DocsDataTable/);
  assert.doesNotMatch(out, /Coven differentiators/);
  assert.match(out, /Trailing prose\./);
}

// <GraphView /> + <HubCards />.
{
  const out = stripMdxLeakage([
    "## Docs Map",
    "<GraphView graph=\"buildGraph()\" />",
    "<HubCards href=\"/docs/familiars\" />",
    "After.",
  ].join("\n"));
  assert.doesNotMatch(out, /<GraphView/);
  assert.doesNotMatch(out, /<HubCards/);
  assert.doesNotMatch(out, /buildGraph/);
  assert.match(out, /## Docs Map/);
  assert.match(out, /After\./);
}

// Wrapping component preserves inner prose (<Callout>…</Callout>).
{
  const out = stripMdxLeakage([
    "<Callout type=\"warn\">",
    "Watch out for stale caches.",
    "</Callout>",
  ].join("\n"));
  assert.doesNotMatch(out, /<Callout/);
  assert.match(out, /Watch out for stale caches\./);
}

// Truncated/dangling opener at end-of-text.
{
  const out = stripMdxLeakage("Prose.\n\n<Mermaid\n  chart=\"`\nflowchart LR\n  UI --> Agent");
  assert.doesNotMatch(out, /<Mermaid/);
  assert.match(out, /Prose\./);
}

// MDX import/export and {/* … */} comments.
{
  const out = stripMdxLeakage([
    "import { Mermaid } from 'fumadocs-ui/components/mermaid';",
    "export const meta = { title: 'Foo' };",
    "",
    "# Heading",
    "{/* TODO */}",
    "Body.",
  ].join("\n"));
  assert.doesNotMatch(out, /import \{ Mermaid/);
  assert.doesNotMatch(out, /export const meta/);
  assert.doesNotMatch(out, /TODO/);
  assert.match(out, /# Heading/);
  assert.match(out, /Body\./);
}

// Heading anchors removed; lowercase HTML untouched.
{
  const out = stripMdxLeakage("## Docs Map [#docs-map]\n\nSome <em>emphasis</em>.");
  assert.match(out, /## Docs Map\n/);
  assert.doesNotMatch(out, /\[#docs-map\]/);
  assert.match(out, /<em>emphasis<\/em>/);
}

console.log("✅  stripMdxLeakage tests passed (8 sections)");

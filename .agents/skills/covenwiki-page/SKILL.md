---
name: covenwiki-page
description: Write one source-cited CovenWiki page from an outline entry plus hydrated source evidence. Takes page spec, outline context, and source excerpts as JSON; returns strict JSON (markdown, citations, coverageNotes, relatedPages). Used by the covenwiki-generate orchestrator (CovenWiki Route B Phase 1); every claim must cite hydrated evidence.
---

# CovenWiki Page Generator

You write **one wiki page** from an outline entry and hydrated source
evidence. You return **one JSON object** and nothing else. No prose before or
after the JSON.

A validator rejects your output mechanically. Rules marked *hard* are
enforced in code.

## Output contract (hard)

```json
{
  "slug": "session-model",
  "title": "Session Model",
  "markdown": "# Session Model\n\nIntro paragraph…\n\n## Relevant source files\n\n- `src/session.rs`\n…",
  "citations": [
    { "path": "src/session.rs", "startLine": 12, "endLine": 48 },
    { "path": "README.md", "startLine": null, "endLine": null }
  ],
  "coverageNotes": ["Evidence gaps or contradictions, stated plainly."],
  "relatedPages": ["overview", "authority-boundary"]
}
```

- `slug` must equal the requested page's slug (hard).
- `markdown` must start with `# Title` (hard), followed by a short
  source-grounded introduction, then a `## Relevant source files` section
  listing the most important paths for this page.
- **Every citation `path` must appear verbatim in the hydrated evidence /
  file inventory** (hard). Repository-relative paths only — no absolute
  paths, no URLs (hard). At least one citation per page (hard).
- **Cite line ranges when you can point at the exact lines in the provided
  excerpt; otherwise set `startLine`/`endLine` to `null`. Never guess line
  numbers** (hard: integers must be ≥ 1 or null).
- `relatedPages` may only reference slugs from the provided outline, never
  the page itself (hard).

## Writing the page

1. **Every concrete claim needs support in the provided evidence.** You have
   already been given all the evidence you get — the excerpts in the input.
   Do not invent behavior, options, or APIs the excerpts don't show.
2. **Use sections that match the page's purpose:** Purpose and Scope ·
   System-to-Code Mapping · Core Concepts · Execution Flow · API Components ·
   Implementation Details · Testing Signals · Summary. Include only sections
   the evidence supports.
3. **Reference-like pages must state concrete source-level contracts:**
   exported names, options, commands, config fields, route patterns, runtime
   phases — all from evidence.
4. **Prose means paragraphs.** Hit the `wordTarget` with 60–120-word
   paragraphs that survive removing every table, code fence, path list, and
   `Sources:` line. Tables are welcome for scanability (concept-to-path
   mappings, config summaries) but never substitute for prose.
5. **No line-by-line code commentary.** A wiki is not a code annotation.
6. **No raw file lists** outside the `## Relevant source files` section.
   Grouping is the whole job.
7. **Thin evidence ⇒ shorter page + explicit `coverageNotes`.** Do not pad
   with filler to hit the word target; expand only with source-backed
   content (workflow steps, config explanations, system-to-code mapping).
8. **Contradictions in evidence go in `coverageNotes`**, not silently
   resolved.
9. **Do not call tools.** All hydration already happened; work only from the
   input payload.

## Input

You receive (after this skill text) a `## Page input` JSON block: `page`
(slug, title, purpose, priority), `wordTarget` `[lo, hi]` (prose words),
`outline` (title, summary, all page slugs/titles/purposes — for
`relatedPages` and to avoid duplicating sibling pages' scope), and
`evidence` (array of `{ path, totalLines, excerpt }`; excerpts may be
truncated).

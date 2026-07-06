# NOTES — Brand & Voice Generator

## Provenance
Vendored verbatim from [coleam00/second-brain-skills](https://github.com/coleam00/second-brain-skills)
(`.claude/skills/brand-voice-generator/`) at commit `75e1e9cd60ef46bffbd294fdfe4d0320cee2f563`
(fetched 2026-07-06). Authored by Cole Medin (coleam00); the generated `plugin.json` author/license
fields are stamped by `scripts/sync-marketplace.py` and do not reflect upstream authorship.

## What's vendored
The complete upstream skill: `SKILL.md` plus `references/` (brand-template, tone-template,
voice-templates, color-presets). Nothing was excluded or modified.

## How it fits
This skill is the front door of the second-brain content pipeline: it interviews the user and
generates `brand.json`, `config.json`, `brand-system.md`, and `tone-of-voice.md` into the
`pptx-generator` pack's `brands/{name}/` directory, which `pptx-generator` then consumes for
on-brand slides and carousels. Install the two together for the full flow.

## Sync integration
`skill.managed: "manual"` in `marketplace/catalog.json` — the authored SKILL.md is the source of
truth; `sync-marketplace.py` generates only the manifests and never rewrites the skill body.
Re-vendor by re-copying from upstream and updating the commit hash above.

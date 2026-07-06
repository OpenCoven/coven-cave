# NOTES — PPTX Generator

## Provenance
Vendored from [coleam00/second-brain-skills](https://github.com/coleam00/second-brain-skills)
(`.claude/skills/pptx-generator/`) at commit `75e1e9cd60ef46bffbd294fdfe4d0320cee2f563`
(fetched 2026-07-06). Authored by Cole Medin (coleam00); the generated `plugin.json` author/license
fields are stamped by `scripts/sync-marketplace.py` and do not reflect upstream authorship.

## What's vendored vs excluded
Vendored: `SKILL.md`, the full `cookbook/` of python-pptx layout templates (incl. `carousels/`),
`generate-cookbook-preview.py`, and `brands/template/` (the scaffold SKILL.md reads when creating
a new brand).

Excluded deliberately:
- `brands/dynamous/` — the upstream author's personal brand instance (incl. a 158 KB logo PNG).
  `brands/` is user-generated content; users create their own with `brand-voice-generator`.
- `cookbook-preview.pptx`, `font-test.pptx` — binary build artifacts. The preview can be
  regenerated locally via `uv run generate-cookbook-preview.py` (SKILL.md documents this).

## How it fits
Consumes per-brand config (`brand.json`, `config.json`, `brand-system.md`, `tone-of-voice.md`)
from `brands/{name}/`, created by the `brand-voice-generator` pack. Install the two together for
the full flow.

## Runtime requirements
Python with `python-pptx` (the SKILL.md drives it via `uv run`). Fonts referenced by a brand must
be installed locally for faithful rendering.

## Sync integration
`skill.managed: "manual"` in `marketplace/catalog.json` — the authored SKILL.md is the source of
truth; `sync-marketplace.py` generates only the manifests and never rewrites the skill body.
Re-vendor by re-copying from upstream (re-applying the exclusions above) and updating the commit
hash.

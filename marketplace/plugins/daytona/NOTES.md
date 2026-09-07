# NOTES - Daytona Sandboxes

## Provenance

Vendored from [daytona/skills](https://github.com/daytona/skills)
(`skills/daytona/`) at commit `ad4d8e088582fc995def67474a03eabede30564e`
(fetched 2026-08-27). Authored by Daytona Platforms Inc. and redistributed
under Apache-2.0. The upstream `LICENSE` and `NOTICE` files are included at the
plugin root.

## What's vendored

The complete upstream skill: `SKILL.md` plus 205 Markdown references covering
the Daytona API, CLI, platform, and Python, TypeScript, Java, Go, and Ruby SDKs.

OpenCoven modified only `SKILL.md` to add explicit secret-handling and remote
state-change guardrails. The bundled reference documentation is unmodified.

## Sync integration

`skill.managed: "manual"` in `marketplace/catalog.json` keeps the vendored
skill and references as the source of truth while `scripts/sync-marketplace.py`
generates the marketplace and client manifests. Re-vendor from upstream,
reapply the documented guardrails, update the pinned commit above and in
`sourceRefs`, then rerun the marketplace checks.

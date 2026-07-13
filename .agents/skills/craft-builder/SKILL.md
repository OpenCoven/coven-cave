---
name: craft-builder
description: Use when asked to build, draft, assemble, or verify a Coven Cave Craft — a versioned bundle of skills, prompts, workflows, and runtime capabilities extracted from a familiar's Roles. Trigger on "build a craft", "draft a craft", "bundle my roles", "package this loadout", or a chat brief that carries the crafts drafts API contract.
---

# Craft Builder

A Craft is a versioned Role loadout: one installable bundle of skills, prompts,
workflows, and runtime capabilities that a Role equips as a unit. Crafts are
built from a familiar's existing Roles through the local Cave API — no files
are hand-authored.

## The build loop

All endpoints are loopback HTTP on the machine running Cave (no auth). Use
`curl` against the running app (ports 3000–3010 in dev; the desktop app serves
the same routes).

1. **Discover roles**

   ```bash
   curl -s http://127.0.0.1:3000/api/roles
   ```

   → `{ ok, roles: [{ id, name, description, familiar, skills, tools, mcpServers, plugins, workflows, effective }] }`

2. **Pick the bundle** — one familiar, the smallest set of its role ids that
   covers the goal. Never invent role ids; only use ids the API returned. If
   nothing plausibly covers the goal, stop and report the closest roles and
   what's missing instead of forcing a draft.

3. **Create the draft**

   ```bash
   curl -s -X POST http://127.0.0.1:3000/api/marketplace/crafts/drafts \
     -H 'content-type: application/json' \
     -d '{"familiar":"<id>","roleIds":["<role-id>"]}'
   ```

   → `{ ok, draft }`. `draft.plugin.id` names the new Craft;
   `draft.extraction.ledger` itemizes the skills / components / workflows /
   prompts / capabilities it bundles, each with the roles it came from.

4. **Verify the install plan**

   ```bash
   curl -s "http://127.0.0.1:3000/api/marketplace/crafts/plan?id=<draft.plugin.id>"
   ```

   → `{ ok, plan }` when the draft resolves. A `{ ok: false, code, diagnostic }`
   response means the bundle can't install as-is — read `diagnostic` (it may
   list affected roles) and adjust the role set rather than shipping a broken
   draft.

5. **Report** — the draft id, the familiar and roles bundled, the ledger
   contents, and anything the plan flagged. The draft appears in
   Marketplace → Crafts for the operator to review, verify, and equip.

## Related endpoints

- `GET /api/marketplace/crafts/drafts` — list existing drafts (avoid
  duplicating one that already covers the goal).
- `POST /api/marketplace/crafts/install` / `.../uninstall` with `{ "id" }` —
  equip or detach a published Craft. Installing is the operator's call; only
  do it when explicitly asked.

## Guardrails

- Drafts are additive and safe; install/uninstall mutate the live loadout.
- One draft per goal — refine an existing draft's role set over creating
  near-duplicates.
- Keep secrets out of Craft names and descriptions.

---
name: opencoven-role-creation-process
description: Read the familiar's SOUL.md and existing roles, decide whether a Role is warranted, draft it from the template with matching workflows, then validate and activate deliberately.
---

# OpenCoven Role Creation Process

Read the familiar's SOUL.md and existing roles, decide whether a Role is warranted, draft it from the template with matching workflows, then validate and activate deliberately.

## Use When
- Draft a domain-specific ROLE.md from templates/ROLE.md with matching workflow files under workflows/<workflow-id>.md
- Place a Role at the canonical source of truth and symlink it into the harness-visible familiar workspace
- Validate a Role with scripts/validate-roles.mjs, confirming frontmatter, listed workflows, symlinks, and SOUL.md relationship text

## Guardrails
- SOUL.md wins over every Role; do not duplicate core identity or personality/vibe rules into a Role
- Role permission declarations do not enforce themselves — the authority layer wins, so set activation deliberately
- High-authority and narrow task Roles should start inactive; avoid broad tool access granted just in case

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.

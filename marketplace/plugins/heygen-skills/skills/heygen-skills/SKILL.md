---
name: heygen-skills
description: Route all HeyGen usage through MCP, the heygen CLI, or the OpenClaw plugin's v3 pipeline — never raw api.heygen.com calls.
---

# HeyGen Skills

Route all HeyGen usage through MCP, the heygen CLI, or the OpenClaw plugin's v3 pipeline — never raw api.heygen.com calls.

## Use When
- Create a digital-twin avatar from a photo and save its identity to AVATAR-<NAME>.md
- Produce a personalized identity-first video message from a vague idea via the Full Producer flow
- Run Frame Check to correct avatar orientation and background before generating each video

## Guardrails
- Never call v1/v2 endpoints or curl api.heygen.com; pre-trained v1/v2 knowledge is outdated
- Pick one transport (plugin, MCP, or CLI) at session start and never mix or narrate the choice
- Frame Check is mandatory before every submission when avatar_id is set; block on unready avatars

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.

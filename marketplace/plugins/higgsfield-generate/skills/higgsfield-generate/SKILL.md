---
name: higgsfield-generate
description: Pick a sensible default model, pass media inputs straight to flags, and submit with --wait so the CLI blocks and prints the result URL in one shot.
---

# Higgsfield Generate

Pick a sensible default model, pass media inputs straight to flags, and submit with --wait so the CLI blocks and prints the result URL in one shot.

## Use When
- Generate a still image with GPT Image 2 or a multi-shot video with Seedance 2.0 from a text prompt
- Do image-to-image or image-to-video work by passing a local file or upload ID to --image, --start-image, or --end-image
- Produce a branded ad video in Marketing Studio by fetching a product from a URL and pairing it with a preset or custom avatar

## Guardrails
- Generation calls a paid external API and can be costly; submit without pre-estimating cost only unless the user asks otherwise
- Requires the higgsfield CLI installed and an authenticated session; on Session expired have the user run higgsfield auth login
- Do not use this skill for Soul Character training, mode-specific product photoshoots, or text-only/chat/TTS tasks — route to the dedicated skill

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.

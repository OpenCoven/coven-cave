---
name: elevenlabs
description: Generate speech and transcribe audio; confirm voice and cost before large jobs.
---

# ElevenLabs

Generate speech and transcribe audio; confirm voice and cost before large jobs.

## Use When
- Synthesize a short voice clip
- Transcribe an audio file
- Pick a voice for a narration

## Guardrails
- Confirm voice, language, and length before generating
- Do not clone voices without consent
- Report output file paths and durations

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.

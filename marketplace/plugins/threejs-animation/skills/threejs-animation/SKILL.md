---
name: threejs-animation
description: Build Three.js animations with AnimationMixer, AnimationClip, and AnimationAction, and blend or crossfade clips in the render loop.
---

# Three.js Animation

Build Three.js animations with AnimationMixer, AnimationClip, and AnimationAction, and blend or crossfade clips in the render loop.

## Use When
- Load and play GLTF clips through an AnimationMixer, selecting clips by name
- Blend idle/walk/run actions by weight or crossfade between animations
- Drive procedural motion with keyframe tracks, morph targets, or spring/oscillation patterns

## Guardrails
- Call mixer.update(delta) every frame or animations will not advance
- Optimize clips and pause off-screen mixers to keep animation cost down
- Resolve morph targets and bones by name via dictionary/lookup rather than hard-coded indices

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.

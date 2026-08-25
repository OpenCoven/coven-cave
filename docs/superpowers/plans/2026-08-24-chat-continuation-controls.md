# Chat continuation controls refinement

Bead: `cave-bnay4`

## Intent

Make the resting chat surface quieter without removing working behavior:

- replace the labeled earlier-turns pill with one full-width arrow seam;
- replace the 32px labeled Code rail with a transparent 14px edge pull tab;
- move the functional Explore/Build access selector into Tools → Response options;
- keep keyboard, screen-reader, reduced-motion, and reduced-transparency behavior intact.

## Implementation

1. Update source-contract tests to describe the new semantics and geometry.
2. Refactor `ChatView`, `ChatSurface`, and `TaskWorkCockpit` markup.
3. Reduce and modernize the corresponding composer, transcript-fold, and rail CSS.
4. Run focused tests, clean TypeScript, lint, the full app test suite, and real-browser visual checks from the managed worktree.
5. Commit with signing and DCO, open a protected PR, resolve review/CI findings, squash merge, and close the Bead with delivery proof.

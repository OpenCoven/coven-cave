# Reviewer Render Announcement Fix

## Problem

`ReviewerSurface.toggleBucket` calls the live-region `announce` function from
inside the functional updater passed to `setBucketFilter`. React may execute
that updater while rendering `ReviewerSurface`, so the announcement updates
`LiveRegionProvider` during another component's render and triggers a console
error.

## Design

Keep the fix local to `ReviewerSurface`. The bucket click handler will derive
the next filter from the handler's current `bucketFilter` value, update the
filter with that value, and then announce the matching status as a separate
operation. The callback dependency list will include `bucketFilter`.

`LiveRegionProvider` will not change. Deferring every announcement globally
would hide invalid render-phase callers and alter announcement timing across
the application.

## Behavior

- Clicking an inactive bucket activates that filter and announces its label.
- Clicking the active bucket clears the filter and announces that the queue
  filter was cleared.
- The announcement remains synchronous with the user action but is no longer
  nested inside a React state updater.

## Verification

Extend `reviewer-surface.test.ts` with a source-contract regression that pins
the state update and announcement as separate handler operations. Run the
reviewer surface test and TypeScript typecheck.

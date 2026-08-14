# GitHub into Code Workshop

## Objective

Remove the standalone GitHub workspace page and make Code Workshop the sole
internal home for GitHub activity, without removing any capability that the
standalone page currently provides.

GitHub access remains role-gated: only familiars with the coding role can use
the integrated surface. A non-coding familiar who follows a GitHub deep link
stays with that familiar and sees a clear unavailable state rather than being
switched automatically or sent to an external browser.

## Success criteria

- The workspace no longer renders or advertises a standalone GitHub page.
- Code Workshop exposes Sessions, Activity, PRs, Issues, and Reviews.
- Activity preserves the former `all` feed, including notifications and mixed
  GitHub activity.
- Search, organization and repository filters, grouping, sorting, PAT setup
  and removal, organization settings, subscriptions, item detail, actions,
  reviews, and linked task/session behavior remain available.
- Legacy `github` workspace state lands on Code Workshop's Activity tab.
- PR and issue URLs open their matching Code Workshop tab and native detail.
- Unsupported GitHub URLs retain the current in-app-browser fallback.
- Non-coding familiars see the existing closed-room treatment with explicit
  coding-role guidance.
- A routed target is consumed once and cannot reopen during a later visit.
- Focused behavior tests, typecheck, lint, and relevant design-system gates
  pass.

## Current state

GitHub is currently both a canonical workspace mode and content embedded in
Code Workshop. The standalone route owns a sidebar row, a workspace render
branch, a lazy-surface export, and warmup behavior. Code Workshop already mounts
the same `GitHubView`, but only through PRs, Issues, and Reviews tabs.

The shared view contains the complete GitHub implementation. The important gap
inside Code Workshop is its `all` filter, which carries notifications and mixed
activity. Routing is the other gap: `Workspace.openGitHubTarget()` sends parsed
PR and issue URLs to the standalone mode, while `CodeRoom` intentionally does
not receive those targets.

The role host already has a closed-room unavailable state, but Workspace
currently redirects away when the active familiar cannot see a requested role
surface. That redirect prevents the selected access-boundary behavior.

## Chosen approach

Code Workshop becomes the sole GitHub owner.

The standalone mode and its UI plumbing are removed. A small, one-shot Code
navigation handoff carries either a requested top tab or a parsed GitHub item
target across the Role Surface boundary. This follows the existing pending
file/diff-open pattern and avoids adding Code-specific fields to every generic
role-surface context.

The existing `GitHubView` remains the only functional GitHub implementation and
continues to load lazily from `CodeView`. No GitHub API or workflow is rewritten.

Two alternatives were rejected:

- Keeping a hidden standalone route that redirects would preserve two ownership
  paths and leave dead page architecture in place.
- Folding GitHub activity into Sessions would obscure notifications and lose
  the clear parity supplied by an Activity tab.

## Information architecture

Code Workshop uses this top-level order:

1. Sessions
2. Activity
3. PRs
4. Issues
5. Reviews

The GitHub tabs map to the existing view filters:

| Code Workshop tab | GitHub filter |
| --- | --- |
| Activity | `all` |
| PRs | `pr` |
| Issues | `issue` |
| Reviews | `review_request` |

Sessions and its workbench remain unchanged. The GitHub tabs retain the shared
view's search, secondary filters, grouping, sorting, details, settings, and
actions. The visual change is limited to one additional tab in the existing
responsive, horizontally scrollable tab strip.

## Navigation and compatibility

`surface:code` is the only rendered internal destination for GitHub work.

- A legacy `github` workspace request becomes an alias for `surface:code` and
  requests Activity.
- A legacy `ctab=github` deep link normalizes to Activity.
- Existing valid Code tabs remain stable.
- A parsed pull-request URL requests PRs and carries the item target.
- A parsed issue URL requests Issues and carries the item target.
- An unsupported URL returns `false` from native target routing and follows the
  existing in-app-browser path.

All workspace entry points continue to pass through the central mode funnel, so
persisted last-mode state, `?mode=` links, command-palette intents, navigation
events, reminders, notifications, and normal URL opens receive the same
migration behavior.

The one-shot handoff has explicit lifecycle rules:

1. Workspace records the Code navigation request before entering the room.
2. `CodeRoom` subscribes to the request and passes it to `CodeView`.
3. `CodeView` selects the requested tab before rendering the GitHub detail.
4. The request is acknowledged after capture.
5. Leaving and reopening Code Workshop cannot replay the acknowledged request.
6. A newer request replaces the current requested target and selects its
   matching tab.

## Access boundary

The Code Workshop sidebar row remains visible only for coding-role familiars.
Direct and compatibility navigation can still request the room so the access
failure is understandable.

When the active familiar lacks the coding role:

- the active familiar does not change;
- no GitHub URL opens externally;
- Workspace remains on the requested Code Workshop room;
- `RoleSurfaceHost` renders its closed-room state;
- the copy identifies the missing coding role and offers the existing route
  back to the Cave.

Workspace must therefore stop immediately redirecting unavailable registered
role rooms to Home. The generic host remains responsible for the loading,
missing-familiar, unknown-room, and wrong-role states it already defines. This
makes the existing unavailable contract observable instead of adding a
Code-specific substitute.

## Component boundaries

### Workspace

Owns URL recognition and destination choice. It no longer renders
`GitHubView`. Valid PR and issue URLs become Code navigation requests; all other
URLs keep their current fallback.

### Code navigation handoff

Stores one pending top-tab or GitHub-item request and exposes subscribe, read,
enqueue, and acknowledge operations. It contains no fetching or rendering
logic.

### CodeRoom

Adapts the generic role context plus the pending Code navigation request into
`CodeView` props. It remains the only Role Surface adapter for Code Workshop.

### CodeView

Owns Code Workshop tab selection. It maps GitHub tabs to filters, selects the
correct tab for incoming targets, acknowledges captured requests, and lazily
mounts the shared view.

### GitHubView

Continues to own GitHub data, preferences, details, credentials, settings, and
actions. Its behavior is reused rather than duplicated. Any small change needed
for one-shot initial-target consumption must preserve normal row selection and
direct prop updates.

## Removal scope

The implementation removes:

- `github` as a canonical rendered workspace mode;
- the standalone GitHub sidebar destination and its conditional hiding logic;
- the standalone workspace render branch;
- the standalone lazy export and warmup path;
- comments and tests that describe GitHub as a peer workspace page.

It does not remove or redesign:

- GitHub data APIs or polling;
- PAT, organization, repository, or subscription management;
- GitHub list and detail behavior;
- PR, issue, review, task, or session actions;
- the Sessions workbench;
- coding-role assignment;
- external browsing for unsupported URLs;
- unrelated role surfaces or global navigation.

## Error and state handling

The consolidation does not introduce success-shaped fallbacks.

- GitHub loading, empty, filtered-empty, PAT-required, request failure, and
  action failure states remain owned by `GitHubView`.
- A malformed or unsupported URL is not coerced into a GitHub item target.
- An unavailable coding role produces an explicit closed-room state.
- Pending navigation is acknowledged only after Code Workshop captures it.
- Leaving the destination clears any unconsumed request so a later role change
  cannot surface stale work unexpectedly.

## Testing and validation

Focused tests will cover:

- the five-tab vocabulary and each GitHub tab-to-filter mapping;
- `github` mode migration into Code Workshop Activity;
- `ctab=github` normalization into Activity;
- PR and issue URL routing into their matching tabs and native details;
- one-shot target consumption and stale-target prevention;
- unsupported URL fallback to the in-app browser;
- the non-coding familiar's closed-room state;
- removal of the GitHub sidebar row;
- removal of the standalone workspace render and lazy-loading paths;
- preservation of existing GitHub view controls and workflows through their
  current behavioral tests.

Validation will use the smallest existing focused test groups first, followed
by typecheck, lint, the design codemod check, and the relevant design-token
drift suite. Browser verification will confirm the tab strip, Activity feed,
PR/issue detail routing, narrow overflow behavior, keyboard focus, and the
wrong-role unavailable state in both light and dark presentation.

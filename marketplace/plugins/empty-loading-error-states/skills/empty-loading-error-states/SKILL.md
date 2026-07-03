---
name: empty-loading-error-states
description: Use when building or reviewing any component that renders async/remote data (lists, tables, dashboards, search results, detail pages, feeds) in React/Vue/Svelte. Enforces the "every data component has five states" discipline: loading, empty, partial, error, ideal. Covers loading-indicator selection (spinner vs skeleton vs progress vs shimmer) against Nielsen 0.1/1/10s limits and the spinner-flash rule; the four empty-state types (first-run, no-results, permission-denied, deleted) with distinct copy+CTA; the five-class error taxonomy (user/network/server/permission/not-found); retry patterns (backoff+jitter, TanStack retry:3/min(1000*2^n,30000), when NOT to retry); toast-vs-inline-vs-banner-vs-dialog placement; the 404/500/offline trio; optimistic UI + Suspense; and WCAG 2.2 SC 4.1.3 announcements (role=status, role=alert, aria-live, aria-busy) + focus. Flags happy-path-only components, blank loading, raw stack traces, blame-the-user copy, and critical errors in auto-dismissing toasts.
---

# Empty, Loading & Error States (the three-states discipline, extended to five)

## Use When
- Building any component bound to async/remote data: list, table, grid, dashboard, search results,
  detail page, feed, infinite scroll, uploader.
- Reviewing a PR that adds/changes a data-bound view and you need a concrete checklist, not vibes.
- Choosing a loading indicator, wiring retries, deciding toast-vs-inline, or writing 404/500/offline pages.
- Debugging "it flashes / it's blank / it dumped a stack trace / the screen reader said nothing."

## Guardrails
- **Enumerate all five states before you build: loading, empty, partial, error, ideal.** The "ideal"
  state is the only one built by default; the other four are found in production by users. Suspense
  handles *loading*, an error boundary handles *error* — **neither handles empty or partial** (that's your
  app logic: `if (items.length === 0) return <EmptyState … />`).
- **Match the indicator to the wait (Nielsen 0.1/1/10s).** < ~300 ms → nothing/optimistic. ~1–10 s small
  region → spinner. Full-page first load with known layout → **skeleton** (shaped like the real content
  to avoid layout shift; never a frame-only skeleton). Known % or > 10 s → **determinate progress**.
  **Delay showing any indicator ~200–500 ms and keep it a minimum ~300–500 ms** to avoid the spinner flash.
- **Never one empty state for all cases.** First-run (teach + one CTA), no-results (echo the query +
  clear-filters), permission-denied (explain access), deleted (confirm outcome) are different components.
- **Errors answer four questions: what happened, why/scope, what to do, a support code.** Plain language,
  a real "Try again", and a short error code/correlation ID. **Never render raw stack traces / PII** — log
  server-side, surface the code. **Never blame the user.** Kill "Invalid input" / bare "Something went wrong".
- **Retry only transient failures** (network/5xx) with **exponential backoff + jitter**; cap the delay
  (TanStack default: retry 3, `min(1000*2^n, 30000)`). **Don't retry 400/401/403/404/validation.** Try a
  silent background retry first so one-off blips never reach the user.
- **Critical errors go inline or in a dialog, never in an auto-dismissing toast** (toasts auto-dismiss,
  don't take focus, are missed; auto-dismiss can fail WCAG 2.2.3/2.2.4). Toasts = transient/recoverable only.
- **Announce every state change to assistive tech (WCAG 2.2 SC 4.1.3).** Loading/"Searching…"/result-count/
  "No results" → `role="status"` (implicit `aria-live="polite"`). **Errors → `role="alert"`** (assertive).
  Use `aria-busy` for multi-part loads; `aria-hidden` the spinner glyph + a visually-hidden status text.
  Inject the live region **before** populating it. **Move focus** to the error heading/Try-again when
  content is *replaced*; **don't** steal focus for an appended non-blocking status.

## Default Flow
1. **Enumerate states.** For the component, list loading / empty(which kinds?) / partial / error(which
   classes?) / ideal. Decide the design for each *now*.
2. **Loading.** Pick from the indicator table (below). Wrap async children in `<Suspense fallback={<Skeleton/>}>`
   for first loads; use in-place spinners for small regions; use `useTransition`/`useDeferredValue` to keep
   old content during updates instead of re-flashing the fallback. Add the show-delay + min-dwell.
3. **Empty.** Branch on *why* it's empty. Build the matching empty state: illustration (`aria-hidden`) +
   one-line title (real heading) + one-line explanation + **one** primary CTA (+ optional secondary/help).
4. **Partial.** For pagination/infinite scroll/streaming: show real content + a *small* trailing loader,
   not a full-page fallback; reserve space to avoid layout shift; announce "Loading more…" politely.
5. **Error.** Wrap the region in an error boundary (`react-error-boundary`'s `<ErrorBoundary
   fallbackRender>` + `resetErrorBoundary`, fallback has `role="alert"`). Classify the error (taxonomy
   table) and give it the right UI weight. Show what/why/action/code. For thrown-in-handler/async errors,
   catch + set state yourself (boundaries only catch render-phase).
6. **Retries.** Transient → backoff + jitter, capped; silent first attempt, then surface. Wire a real
   "Try again" and focus it. Skip retries for 4xx/deterministic failures.
7. **Perceived speed.** Optimistic writes (`useOptimistic` / TanStack `onMutate`+rollback), streaming SSR,
   right-grained Suspense boundaries, progressive images with reserved dimensions.
8. **Fallback trio.** Ship 404 (exists?/back-to-safety), 500 (own it/retry/code), offline (detect via
   `online`/`offline` + SW fallback, queue writes, auto-recover).
9. **A11y pass.** `role="status"` for status, `role="alert"` for errors, `aria-busy` for multi-part,
   `aria-live` politeness correct, live region pre-exists, focus managed on replace. Verify with a screen
   reader that load→content, "no results", and error transitions are all announced.
10. **Review against the anti-pattern list** before shipping/approving.

## Loading indicator selection
| Indicator | Use when | Avoid when |
|---|---|---|
| Nothing / optimistic | < ~300 ms; local state; optimistic writes | you can't guarantee speed |
| Spinner | short indeterminate ~1–10 s; small in-place regions | full-page first loads; > 10 s |
| Skeleton (shaped) | full-page/large-region first loads, known layout | tiny regions; unknown layout; frame-only |
| Determinate progress | known %; uploads/jobs; > 10 s | truly indeterminate work |
| Indeterminate progress | long indeterminate work | when you actually know the % |
| Shimmer | skeletons signaling "working" | motion-sensitive (respect `prefers-reduced-motion`) |

## Error taxonomy → treatment
| Class | Example | UI weight | Retry? |
|---|---|---|---|
| User error | bad form value | inline, at the field, suggest fix | no |
| Network | offline / timeout | inline or toast; "check connection" | yes (auto+manual) |
| Server 5xx | backend down | section/full error state + code | yes (backoff) |
| Permission 403 | not allowed | explain access; request/contact CTA | no |
| Not found 404 | wrong id / deleted | "doesn't exist"; link back | no |

## Signal placement
- **Inline** — field validation; a specific item/section that failed.
- **Toast/snackbar** — transient, non-blocking confirmations + background failures. **Not** critical errors.
- **Banner** — persistent, in-flow (connection lost, degraded service, page-level failure).
- **Alert dialog** (`role="alertdialog"` + focus) — destructive confirmations; blocking errors.

## ARIA cheat sheet
- `role="status"` = implicit `aria-live="polite"` + `aria-atomic="true"`; loading / result count / "No results". Don't move focus.
- `role="alert"` = implicit `aria-live="assertive"`; errors. Reserve assertive for genuine urgency.
- `aria-busy="true"` during multi-part loads → `"false"` when done, so SR waits for a complete update.
- Live region must exist in the DOM **before** it's populated. Spinner glyph → `aria-hidden="true"` + visually-hidden status text.
- Focus: move to error heading / "Try again" when a region is **replaced**; leave focus alone for appended non-blocking status.

## Anti-patterns to flag in review
- Happy-path only (no loading/empty/error branches) · blank screen on load · spinner flash (shown/hidden
  < 300 ms) · one empty state for all cases (first-run CTA on a no-results search) · raw stack trace / server
  dump to user · vague or blaming error copy · no retry affordance (dead end) · retrying 4xx/deterministic
  failures · critical error in an auto-dismissing toast · state change silent to SR (no `role=status`/`alert`)
  · `aria-live="assertive"` on everything · focus dropped when content replaced by error · frame-only
  skeleton · layout shift on load→content swap · page-level Suspense fallback blocking fast regions.

## Copy (hand to charm for polish)
- Empty first-run: "No projects yet. Create your first project to get started." + one CTA.
- Empty no-results: "No results for 'xyz'. Try a different search or clear filters." (never the first-run CTA).
- Loading: "Loading your projects…" / "Searching…" in a `role="status"`.
- Error recoverable: "We couldn't load your projects. Check your connection and try again." + [Try again] + `Ref: 8F3A-21`.
- Error 500: "Something went wrong on our end. We've been notified. Try again in a moment." (own it).
- Never: "Invalid input", "Error 0x0", bare "Oops!", or raw exception text.

## References (verified 2026-07-01)
- React `<Suspense>`: https://react.dev/reference/react/Suspense · Error boundaries: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary · `useOptimistic`: https://react.dev/reference/react/useOptimistic
- `react-error-boundary`: https://github.com/bvaughn/react-error-boundary
- TanStack Query retries (retry 3, `min(1000*2^n,30000)`): https://tanstack.com/query/latest/docs/framework/react/guides/query-retries · optimistic updates: https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
- NN/g: response times https://www.nngroup.com/articles/response-times-3-important-limits/ · progress indicators https://www.nngroup.com/articles/progress-indicators/ · skeletons https://www.nngroup.com/articles/skeleton-screens/ · empty states https://www.nngroup.com/articles/empty-state-interface-design/ · no-results https://www.nngroup.com/articles/search-no-results-serp/ · error messages https://www.nngroup.com/articles/error-message-guidelines/
- Material: M3 progress https://m3.material.io/components/progress-indicators/guidelines · M2 empty states https://m2.material.io/design/communication/empty-states.html
- A11y: WCAG 2.2 SC 4.1.3 https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html · APG Alert https://www.w3.org/WAI/ARIA/apg/patterns/alert/ · MDN live regions https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions · `role=status` https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role · `aria-busy` https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy

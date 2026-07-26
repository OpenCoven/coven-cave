# Dashboard Shipped Data Table Design

## Problem

The dashboard's **Today's report** panel renders merged pull requests under **Shipped** as a wrapping chip list. The list has no height limit, so active days can make the summary panel dominate the page. The chips also hide the pull-request title and offer no way to search or reorder the data.

## Scope

Replace only the dashboard section titled **Shipped** in `TodaySummary`. The standalone daily report retains its separately named **Merged pull requests** list. Existing daily-summary collection and persistence are unchanged.

The result must:

- cap the Shipped region at `300px` and scroll its rows internally;
- filter immediately by pull-request title, full or short repository name, and PR number;
- sort by pull request, repository, or merged time;
- default to merged time descending;
- preserve direct links to each pull request;
- remain usable in narrow dashboard panes and with keyboard or assistive technology.

## Architecture

`TodaySummary` remains a server component. It passes `summary.report.prsMerged` and `now.getTime()` to a focused client component, `ShippedTable`, so the surrounding report does not become client-rendered and the client boundary receives an explicitly serializable timestamp.

The table module owns exported pure helpers for filtering, stable sorting, and the three-state sort cycle. Keeping those rules outside React makes their behavior directly testable without coupling tests to component internals.

No new dependency or generic table abstraction is introduced. The component uses the repository's existing dashboard tokens, `Icon`, semantic HTML, and React state.

## Data and state

Rows use the existing `MergedPr` shape: `repo`, `number`, `title`, `url`, and `mergedAt`. `ShippedTable` receives a readonly array and never mutates the frozen report facts.

Local client state consists of:

- `query`, initially empty;
- `sort`, initially `null`, representing the default merged-newest order.

The displayed rows are derived with `useMemo`: normalize and filter the input first, then apply either the selected sort or the default order. Invalid merge timestamps sort after valid timestamps, with the original input index as the final stable tie-breaker.

## Interaction design

A compact toolbar appears above the table. Its search field says **Filter shipped work…** and has an accessible label that names titles, repositories, and PR numbers. A result count remains visible as `visible / total`; it uses `role="status"` so filtering changes are announced without moving focus.

Column headers are real buttons inside `<th>` elements:

- **Pull request** sorts title text ascending, descending, then returns to default;
- **Repository** sorts full repository name and then PR number;
- **Merged** sorts time descending on first activation, ascending on second, then returns to default.

Each active header exposes `aria-sort="ascending"` or `aria-sort="descending"`; inactive sortable headers expose `aria-sort="none"`. A caret icon communicates direction visually.

Rows show the pull-request title as the primary link, `owner/repo#number` as repository context, and the existing relative merged time. Opening a row keeps the existing new-tab behavior and safe `rel="noreferrer"` contract.

When no rows match, the table body renders one plain-language row: **No shipped work matches this filter.** Clearing the search restores the full table without changing the selected sort.

## Layout and visual direction

The Shipped block keeps the existing report-panel hierarchy and restrained Coven dashboard styling. The table is a dense working ledger rather than a second card stack: hairline separators, a quiet raised surface, tabular metadata, and the existing blue information accent reserved for links and active sort state.

The toolbar and table share one bordered shell. The scrolling viewport has `max-height: 300px`, `overflow: auto`, contained overscroll, and a thin scrollbar. The header is sticky at the top of that viewport so column meaning remains visible while rows scroll.

The table has a practical minimum width and may scroll horizontally inside its own viewport. At narrow container widths, repository and merged metadata stay readable rather than collapsing into ambiguous unlabeled values. The surrounding dashboard and document must not gain horizontal overflow.

## Accessibility

- Use native `<table>`, `<thead>`, `<tbody>`, `<th scope="col">`, and `<td>` elements.
- Use native buttons for sorting and a native search input for filtering.
- Keep visible focus treatment through existing control and link focus styles.
- Expose sort state with `aria-sort` and filtering results through a polite status region.
- Give the scroll viewport `tabIndex={0}` and an accessible label, so keyboard users can scroll it directly whenever content overflows.
- Preserve full titles with text wrapping or a `title` fallback; essential information cannot exist only in hover content.

## Testing and verification

Automated coverage will prove:

- filtering matches title, full/short repository, and `#number`, case-insensitively;
- sorting is stable, handles invalid dates, and restores merged-newest default order;
- header controls and `aria-sort` are wired into the rendered component source;
- `TodaySummary` uses `ShippedTable` instead of the old chip map;
- the stylesheet supplies the `300px` cap, internal overflow, and sticky header;
- the new test is included in the explicit app-suite manifest.

Verification will run the focused new test, the relevant dashboard page test, `pnpm check:tests-wired`, `pnpm typecheck`, and `pnpm test:app`. A real browser pass on the dashboard will confirm the bounded height, vertical and horizontal scrolling, filtering, sort cycling, sticky header, PR links, focus visibility, and narrow-width behavior.

## Out of scope

- Changing the standalone daily-report page.
- Fetching live GitHub data from the table.
- Pagination, virtualization, row selection, or bulk actions.
- Changing how daily summaries collect, freeze, or refresh merged pull requests.

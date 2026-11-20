/**
 * Shared readable-fallback corpus for `coven:ui` blocks (#6060).
 *
 * Surfaces that don't draw the native UI tier (Quick Chat, the expanded
 * reader, Copy and iOS) show a plain-text projection of each active block
 * instead of its raw markup (src/lib/ui-block-readable.ts). Every surface's
 * test reads these cases, and apps/ios/CovenCave/CovenCaveTests mirrors them
 * case for case, so a projection change lands everywhere or fails somewhere.
 *
 * Which fences are active comes from `sliceUiBlocks` (src/lib/ui-blocks.ts):
 * an example inside another fence, a list item, a quote or indented code
 * stays literal, byte for byte. A body the parser can't read as markup
 * (status "fallback") also stays literal, as the source fence.
 *
 * `readable` is the Copy form: one line per item, joined with "\n", values
 * evaluated at each State's initial value and formatted for en-US.
 *
 *   Card            title, then subtitle
 *   Heading, Text   their text, expressions evaluated; Bold and Code add only their text
 *   Badge           label, or its text
 *   Stat            "label: value", then " caption", then " (12% increase)" or " (unchanged)"
 *   Table           columns, then each row, cells joined with " | "; caption. A badge cell is its label
 *   Progress        "label: value of max"
 *   BarChart, Sparkline  "label: Mon 4, Tue 6"
 *   Donut           "label: Cody 9 (50%), Nova 6 (33%)"
 *   Slider, Select  "label: value" (a Select shows its option's label)
 *   Toggle          "label: on" or "label: off"
 *   TextInput       "label: value", or the label alone while it's empty
 *   List            "- item", or "1. item" when ordered
 *   Callout         "Warning: title" (the tone word a reader hears), then its children
 *   Tabs            label, then each Tab's label followed by its children
 *   Button          "[label]" (a label only; nothing runs, sends or prefills)
 *   State, Stack, Row, Grid, Columns, Divider and pending skeletons add no line of their own.
 *
 * A node that failed validation contributes only its children's lines (an
 * inline component's text stays one line, #6067), and the block ends with
 * "(Some parts of this block couldn't be shown.)". A settled block that ended
 * early ends with "(This block ended early.)".
 */

import {
  DELIVERY_PULSE,
  FAILED_CHILD_TEXT,
  MALFORMED_DASHBOARD,
  MINI_DASHBOARD,
  PRICING_CALCULATOR,
  RELEASE_BRIEF,
  RELEASE_DRAFT,
  STATUS_TABLE,
  uiBlockFence,
} from "./ui-block-fixtures.ts";

const COLUMNS_AND_CALLOUTS = `<Columns columns={2}>
  <Callout tone="success" title="Shipped">
    <Text>All checks pass.</Text>
  </Callout>
  <Callout tone="accent">
    <Text>An accent callout has no tone word.</Text>
  </Callout>
</Columns>`;

export type UiBlockFallbackCase = {
  id: string;
  kind: "complete" | "partial" | "malformed" | "nested-literal";
  /** The whole assistant message, as saved. */
  input: string;
  /** The message with each active block projected to readable text. */
  readable: string;
};

const PRICING_READABLE = [
  "Seat pricing",
  "Team plan, billed monthly",
  "Seats: 8",
  "Bill annually (2 months free): off",
  "Monthly: $232.00",
  "Per seat: $29.00",
  "Yearly: $2,784.00",
  "8 seats at $29 each.",
  "[Reset]",
  "[Draft upgrade request]",
].join("\n");

const LITERAL_EXAMPLE = uiBlockFence(`<Card title="Example">
  <Text>Not a live block.</Text>
</Card>`);

export const UI_BLOCK_FALLBACK_CASES: readonly UiBlockFallbackCase[] = [
  {
    id: "pricing-calculator",
    kind: "complete",
    input: `Here is the estimate.\n\n${uiBlockFence(PRICING_CALCULATOR)}\n\nAdjust seats any time.`,
    readable: `Here is the estimate.\n\n${PRICING_READABLE}\n\nAdjust seats any time.`,
  },
  {
    id: "status-table",
    kind: "complete",
    input: uiBlockFence(STATUS_TABLE),
    readable: [
      "Service status",
      "Last checked 2 minutes ago",
      "4 healthy",
      "1 degraded",
      "1 down",
      "Service | Status | p95 latency | Uptime",
      "api | healthy | 118 ms | 99.98%",
      "auth | healthy | 64 ms | 99.99%",
      "search | degraded | 842 ms | 99.20%",
      "billing | healthy | 131 ms | 99.95%",
      "exports | down | n/a | 97.10%",
      "webhooks | healthy | 92 ms | 99.97%",
      "Six services in us-east",
      "Exports has been down since 09:12. Search latency is rising.",
    ].join("\n"),
  },
  {
    id: "mini-dashboard",
    kind: "complete",
    input: uiBlockFence(MINI_DASHBOARD),
    readable: [
      "Weekly delivery",
      "Range: This week",
      "Merged PRs: 23",
      "Median review: 3.4 hours",
      "Failed builds: 2",
      "Sprint scope done: 68 of 100",
      "Merged PRs per day: Mon 4, Tue 6, Wed 3, Thu 7, Fri 3",
    ].join("\n"),
  },
  {
    id: "two-blocks-with-prose",
    kind: "complete",
    input: [
      "First:",
      "",
      uiBlockFence(`<Heading level={3}>Plan A</Heading>\n<Button prefill="Pick plan A">Choose A</Button>`),
      "",
      "Second:",
      "",
      uiBlockFence(`<Stat label="Cost" value={12} format="usd" caption="per month" />`),
    ].join("\n"),
    readable: ["First:", "", "Plan A", "[Choose A]", "", "Second:", "", "Cost: $12.00 per month"].join("\n"),
  },
  {
    id: "release-brief",
    kind: "complete",
    input: uiBlockFence(RELEASE_BRIEF),
    readable: [
      "Release brief",
      "Cave 0.6, planned for Friday",
      "Warning: Freeze starts Thursday",
      "Run pnpm test:app before you merge, and don't skip pnpm lint.",
      "Merged: 42",
      "Open: 7",
      "Blocked: 2",
      "Ships",
      "- Native UI blocks",
      "- Faster startup",
      "- Quieter inbox",
      "Then",
      "1. Tag the release",
      "2. Publish the notes",
      "3. Watch crash reports",
    ].join("\n"),
  },
  {
    id: "delivery-pulse",
    kind: "complete",
    input: uiBlockFence(DELIVERY_PULSE),
    readable: [
      "Delivery pulse",
      "Last 7 days",
      "Merged PRs: 23 (12% increase)",
      "Median review: 3.4 hours (0.8 decrease)",
      "Failed builds: 2 (unchanged)",
      "Merges per day: Mon 4, Tue 6, Wed 3, Thu 7, Fri 3",
      "Review load: Cody 9 (50%), Nova 6 (33%), Val 3 (17%)",
      "Service | Status",
      "api | healthy",
      "exports | down",
      "search | n/a",
      "Service health",
    ].join("\n"),
  },
  {
    id: "release-draft",
    kind: "complete",
    input: uiBlockFence(RELEASE_DRAFT),
    readable: [
      "Release notes draft",
      "Draft sections",
      "Summary",
      "Headline: Faster startup",
      "Headline: Faster startup",
      "Details",
      "- Startup is 40% faster",
      "- The inbox is quieter",
      "[Draft the announcement]",
    ].join("\n"),
  },
  {
    id: "columns-and-callouts",
    kind: "complete",
    input: uiBlockFence(COLUMNS_AND_CALLOUTS),
    readable: ["Success: Shipped", "All checks pass.", "An accent callout has no tone word."].join("\n"),
  },
  {
    id: "unterminated-final-block",
    kind: "partial",
    input: "Drafting:\n\n```coven:ui\n<Card title=\"Draft\">\n  <Text>First line</Text>",
    readable: ["Drafting:", "", "Draft", "First line", "(This block ended early.)"].join("\n"),
  },
  {
    id: "cut-mid-tag",
    kind: "partial",
    input: "```coven:ui\n<Stack>\n  <Heading level={2}>Totals</Heading>\n  <Stat label=\"Spend\" val",
    readable: ["Totals", "(This block ended early.)"].join("\n"),
  },
  {
    id: "malformed-dashboard",
    kind: "malformed",
    input: uiBlockFence(MALFORMED_DASHBOARD),
    readable: [
      "Partly broken",
      "Valid stat: 6",
      "Unknown prop",
      "Raw style",
      "Still rendered after the failures.",
      "(Some parts of this block couldn't be shown.)",
    ].join("\n"),
  },
  {
    // Tag-shaped text from a string stays text; nothing here becomes markup.
    id: "failed-child-text",
    kind: "malformed",
    input: uiBlockFence(FAILED_CHILD_TEXT),
    readable: [
      "Release check",
      "Score: 3 of 5 checks pass",
      "Mood is glow today",
      "window.__covenUiInjected = true",
      "Trend is up",
      "Shown as <b onclick='window.__covenUiInjected = true'>text</b>",
      "Still rendered",
      "(Some parts of this block couldn't be shown.)",
    ].join("\n"),
  },
  {
    id: "json-body-stays-literal",
    kind: "malformed",
    input: "```coven:ui\n{\"type\": \"Card\", \"title\": \"Not markup\"}\n```",
    readable: "```coven:ui\n{\"type\": \"Card\", \"title\": \"Not markup\"}\n```",
  },
  {
    id: "example-inside-fence",
    kind: "nested-literal",
    input: "Syntax:\n\n````markdown\n" + LITERAL_EXAMPLE + "\n````",
    readable: "Syntax:\n\n````markdown\n" + LITERAL_EXAMPLE + "\n````",
  },
  {
    id: "example-on-list-marker",
    kind: "nested-literal",
    input: "- " + LITERAL_EXAMPLE.split("\n").join("\n  "),
    readable: "- " + LITERAL_EXAMPLE.split("\n").join("\n  "),
  },
  {
    id: "example-in-list-fence",
    kind: "nested-literal",
    input: "- ```\n  " + LITERAL_EXAMPLE.split("\n").join("\n  ") + "\n  ```",
    readable: "- ```\n  " + LITERAL_EXAMPLE.split("\n").join("\n  ") + "\n  ```",
  },
  {
    id: "example-in-list-continuation",
    kind: "nested-literal",
    input: "- Use this:\n\n  " + LITERAL_EXAMPLE.split("\n").join("\n  "),
    readable: "- Use this:\n\n  " + LITERAL_EXAMPLE.split("\n").join("\n  "),
  },
  {
    id: "example-in-tight-list-continuation",
    kind: "nested-literal",
    input: "1. Use this:\n   " + LITERAL_EXAMPLE.split("\n").join("\n   "),
    readable: "1. Use this:\n   " + LITERAL_EXAMPLE.split("\n").join("\n   "),
  },
  {
    id: "example-in-quote",
    kind: "nested-literal",
    input: "> " + LITERAL_EXAMPLE.split("\n").join("\n> "),
    readable: "> " + LITERAL_EXAMPLE.split("\n").join("\n> "),
  },
  {
    id: "example-indented-code",
    kind: "nested-literal",
    input: "Indented:\n\n    " + LITERAL_EXAMPLE.split("\n").join("\n    "),
    readable: "Indented:\n\n    " + LITERAL_EXAMPLE.split("\n").join("\n    "),
  },
];

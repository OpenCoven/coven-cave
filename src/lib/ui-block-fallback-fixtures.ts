/**
 * Shared readable-fallback corpus for `coven:ui` blocks (#6060).
 *
 * Surfaces that don't draw the native UI tier (Quick Chat, the expanded
 * reader, Copy and iOS) show a plain-text projection of each active block
 * instead of its raw markup. Every surface's test reads these cases, and
 * apps/ios/CovenCave/CovenCaveTests mirrors them case for case, so a
 * projection change lands everywhere or fails somewhere.
 *
 * Which fences are active comes from `sliceUiBlocks` (src/lib/ui-blocks.ts, #6073):
 * an example inside another fence, a list item, a quote or indented code
 * stays literal, byte for byte. A body the parser can't read as markup
 * (status "fallback") also stays literal, as the source fence.
 *
 * `readable` is the Copy form: one line per item, joined with "\n", values
 * evaluated at each State's initial value and formatted for en-US.
 *
 *   Card            title, then subtitle
 *   Heading, Text   their text, expressions evaluated
 *   Badge           label, or its text
 *   Stat            "label: value", then " caption" when present
 *   Table           columns, then each row, cells joined with " | "; caption
 *   Progress        "label: value of max"
 *   BarChart        "label: Mon 4, Tue 6"
 *   Slider, Select  "label: value"
 *   Toggle          "label: on" or "label: off"
 *   Button          "[label]" (a label only; nothing runs, sends or prefills)
 *   State, Stack, Row and pending skeletons add no line of their own.
 *
 * A node that failed validation contributes only its children's lines, and
 * the block ends with "(Some parts of this block couldn't be shown.)". A
 * settled block that ended early ends with "(This block ended early.)".
 */

// The four bodies below are copies of the ones in #6073's src/lib/ui-block-fixtures.ts.
// Once #6073 merges, import them from there instead of keeping copies.

const PRICING_CALCULATOR = `<Card title="Seat pricing" subtitle="Team plan, billed monthly">
  <State name="seats" initial={8} />
  <State name="annual" initial={false} />
  <Slider bind="seats" min={1} max={50} label="Seats" />
  <Toggle bind="annual" label="Bill annually (2 months free)" />
  <Row gap="md">
    <Stat label="Monthly" value={annual ? seats * 29 * 10 / 12 : seats * 29} format="usd" />
    <Stat label="Per seat" value={annual ? 29 * 10 / 12 : 29} format="usd" />
    <Stat label="Yearly" value={annual ? seats * 29 * 10 : seats * 29 * 12} format="usd" tone="accent" />
  </Row>
  <Text tone="muted">{seats} seats at $29 each.{annual ? " Annual billing applied." : ""}</Text>
  <Row gap="sm">
    <Button set="seats" to={8}>Reset</Button>
    <Button variant="primary" prefill={"Upgrade our workspace to " + seats + " seats" + (annual ? ", billed annually." : ", billed monthly.")}>Draft upgrade request</Button>
  </Row>
</Card>`;

const STATUS_TABLE = `<Card title="Service status" subtitle="Last checked 2 minutes ago">
  <Row gap="sm">
    <Badge tone="success">4 healthy</Badge>
    <Badge tone="warning">1 degraded</Badge>
    <Badge tone="danger">1 down</Badge>
  </Row>
  <Table
    columns={["Service", "Status", "p95 latency", "Uptime"]}
    rows={[
      ["api", "healthy", "118 ms", "99.98%"],
      ["auth", "healthy", "64 ms", "99.99%"],
      ["search", "degraded", "842 ms", "99.20%"],
      ["billing", "healthy", "131 ms", "99.95%"],
      ["exports", "down", "n/a", "97.10%"],
      ["webhooks", "healthy", "92 ms", "99.97%"]
    ]}
    caption="Six services in us-east"
  />
  <Text size="sm" tone="muted">Exports has been down since 09:12. Search latency is rising.</Text>
</Card>`;

const MINI_DASHBOARD = `<Stack gap="md">
  <Heading level={2}>Weekly delivery</Heading>
  <State name="range" initial="This week" />
  <Select bind="range" label="Range" options={["This week", "Last week"]} />
  <Row gap="md">
    <Stat label="Merged PRs" value={range == "This week" ? 23 : 17} format="number" />
    <Stat label="Median review" value={range == "This week" ? 3.4 : 5.1} format="number" caption="hours" />
    <Stat label="Failed builds" value={range == "This week" ? 2 : 6} tone={"danger"} />
  </Row>
  <Progress label="Sprint scope done" value={range == "This week" ? 68 : 100} max={100} tone="success" />
  <BarChart
    label="Merged PRs per day"
    data={[
      { label: "Mon", value: range == "This week" ? 4 : 2 },
      { label: "Tue", value: range == "This week" ? 6 : 3 },
      { label: "Wed", value: range == "This week" ? 3 : 5 },
      { label: "Thu", value: range == "This week" ? 7 : 4 },
      { label: "Fri", value: range == "This week" ? 3 : 3 }
    ]}
  />
</Stack>`;

const MALFORMED_DASHBOARD = `<Card title="Partly broken">
  <State name="count" initial={3} />
  <Stat label="Valid stat" value={count * 2} />
  <Sparkline values={[1, 2, 3]} />
  <Badge colour="red">Unknown prop</Badge>
  <Text style="color: red">Raw style</Text>
  <Stat label="Calls a function" value={alert(1)} />
  <Stat label="Reads a property" value={window.location} />
  <Stat label="Undeclared state" value={missing + 1} />
  <Text>Still rendered after the failures.</Text>
</Card>`;

function uiBlockFence(body: string): string {
  return "```coven:ui\n" + body + "\n```";
}

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

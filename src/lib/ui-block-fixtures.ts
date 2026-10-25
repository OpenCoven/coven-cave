/**
 * Shared `coven:ui` fixtures for the native UI tier spike.
 *
 * The unit tests (src/lib/ui-blocks.test.ts) feed every prefix of these
 * bodies through the parser, and the Playwright spec
 * (tests/chat-ui-block.spec.ts) renders the same bodies in a real chat turn.
 * Keep them realistic: they are what a familiar would plausibly write.
 */

export const PRICING_CALCULATOR = `<Card title="Seat pricing" subtitle="Team plan, billed monthly">
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

export const STATUS_TABLE = `<Card title="Service status" subtitle="Last checked 2 minutes ago">
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

export const MINI_DASHBOARD = `<Stack gap="md">
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

/**
 * Deliberately broken: an unknown component, an unknown prop, a raw style, a
 * function call, member access, and an undeclared state. Each failure must
 * render as its own error chip while every valid sibling still renders.
 */
export const MALFORMED_DASHBOARD = `<Card title="Partly broken">
  <State name="count" initial={3} />
  <Stat label="Valid stat" value={count * 2} />
  <Marquee values={[1, 2, 3]} />
  <Badge colour="red">Unknown prop</Badge>
  <Text style="color: red">Raw style</Text>
  <Stat label="Calls a function" value={alert(1)} />
  <Stat label="Reads a property" value={window.location} />
  <Stat label="Undeclared state" value={missing + 1} />
  <Text>Still rendered after the failures.</Text>
</Card>`;

/**
 * Deliberately broken around readable text (#6067): a bad prop on a Text with
 * an expression inside, a dynamic tone outside the token list, and HTML-like
 * markup (a script tag, an img with onerror, and a string that looks like a
 * tag). Each failed node shows its chip, then its validated text in reading
 * order; the markup stays inert and the sibling after the failures renders.
 */
export const FAILED_CHILD_TEXT = `<Card title="Release check">
  <State name="score" initial={3} />
  <State name="mood" initial="glow" />
  <Text colour="red">Score: {score} of 5 checks pass</Text>
  <Text tone={mood}>Mood is {mood} today</Text>
  <Marquee><script>window.__covenUiInjected = true</script>Trend is up</Marquee>
  <img src="x" onerror="window.__covenUiInjected = true" />
  <Text size="huge">Shown as {"<b onclick='window.__covenUiInjected = true'>text</b>"}</Text>
  <Badge tone="success">Still rendered</Badge>
</Card>`;

/**
 * Layout and text catalog (#6062 T3): a Callout with inline Bold and Code, a
 * three-column Grid, a Divider, and unordered and ordered Lists.
 */
export const RELEASE_BRIEF = `<Card title="Release brief" subtitle="Cave 0.6, planned for Friday">
  <Callout title="Freeze starts Thursday" tone="warning">
    <Text>Run <Code>pnpm test:app</Code> before you merge, and <Bold>don't skip <Code>pnpm lint</Code></Bold>.</Text>
  </Callout>
  <Grid columns={3} gap="sm">
    <Stat label="Merged" value={42} />
    <Stat label="Open" value={7} />
    <Stat label="Blocked" value={2} tone="danger" />
  </Grid>
  <Divider />
  <Heading level={3}>Ships</Heading>
  <List items={["Native UI blocks", "Faster startup", "Quieter inbox"]} />
  <Heading level={3}>Then</Heading>
  <List ordered items={["Tag the release", "Publish the notes", "Watch crash reports"]} />
</Card>`;

/**
 * Data catalog (#6062 T4): Stat trends, a Sparkline, a Donut, and badge cells
 * in a Table. Trend tones are explicit: a falling review time is good news.
 */
export const DELIVERY_PULSE = `<Card title="Delivery pulse" subtitle="Last 7 days">
  <Row gap="md">
    <Stat label="Merged PRs" value={23} trend={12} trendFormat="percent" trendTone="success" />
    <Stat label="Median review" value={3.4} caption="hours" trend={-0.8} trendTone="success" />
    <Stat label="Failed builds" value={2} trend={0} />
  </Row>
  <Sparkline label="Merges per day" tone="accent" data={[
    { label: "Mon", value: 4 },
    { label: "Tue", value: 6 },
    { label: "Wed", value: 3 },
    { label: "Thu", value: 7 },
    { label: "Fri", value: 3 }
  ]} />
  <Donut label="Review load" data={[
    { label: "Cody", value: 9, tone: "accent" },
    { label: "Nova", value: 6, tone: "warning" },
    { label: "Val", value: 3 }
  ]} />
  <Table
    columns={["Service", "Status"]}
    rows={[
      ["api", { kind: "badge", label: "healthy", tone: "success" }],
      ["exports", { kind: "badge", label: "down", tone: "danger" }],
      ["search", "n/a"]
    ]}
    caption="Service health"
  />
</Card>`;

export const UI_BLOCK_FIXTURES = {
  "pricing-calculator": PRICING_CALCULATOR,
  "status-table": STATUS_TABLE,
  "mini-dashboard": MINI_DASHBOARD,
  "malformed-dashboard": MALFORMED_DASHBOARD,
  "failed-child-text": FAILED_CHILD_TEXT,
  "release-brief": RELEASE_BRIEF,
  "delivery-pulse": DELIVERY_PULSE,
} as const;

/** Wrap a body in the fence a familiar emits. */
export function uiBlockFence(body: string): string {
  return "```coven:ui\n" + body + "\n```";
}

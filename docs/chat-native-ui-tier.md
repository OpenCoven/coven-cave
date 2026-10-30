# Native UI tier for chat (`coven:ui`)

Status: the parser and the Main Chat renderer are on `main`, merged in #6073 (2026-10-24). The catalog is complete (#6062, through #6229, #6234 and #6238). Every surface without the native tier shows readable text instead: Quick Chat, the expanded reader, iOS and every Copy (#6060, completed 2026-10-26). Whether any of them should become interactive is #6280. Familiar prompt changes are a separate follow-up (#6063), and no familiar has been taught the syntax yet.

Cave chat had two UI tiers. Fixed `coven:` marker cards are native and safe but have no layout or state. Sandboxed HTML/React artifacts are powerful but ignore Cave's tokens and look foreign. The native UI tier sits between them: a familiar composes a small typed catalog of components, and Cave validates the markup and draws it with its own components and design tokens, progressively, while the reply streams.

## Syntax

A familiar writes a fenced block of JSX-like markup:

````markdown
```coven:ui
<Card title="Seat pricing">
  <State name="seats" initial={8} />
  <Slider bind="seats" min={1} max={50} label="Seats" />
  <Stat label="Monthly" value={seats * 29} format="usd" />
  <Button prefill={"Upgrade our workspace to " + seats + " seats."}>Draft upgrade request</Button>
</Card>
```
````

- Props take double-quoted text (`title="Seat pricing"`) or an `{expression}`.
- Text children may interpolate expressions: `<Text>{seats} seats</Text>`.
- `{/* comments */}` and `<!-- comments -->` are ignored.
- Whitespace collapses like HTML. A run containing a newline reads as one space, and formatting whitespace between tags disappears.

## Catalog

| Component | Props | Children |
| --- | --- | --- |
| `Stack` | `gap`, `align` | components |
| `Row` | `gap`, `align`, `justify`, `wrap` | components |
| `Card` | `title`, `subtitle`, `tone`, `gap` | components |
| `Grid` / `Columns` | `columns` (1–4), `gap`, `align` | components |
| `Callout` | `title`, `tone` (default `info`), `gap` | components |
| `Divider` | `gap` | none |
| `Heading` | `level` (1–4) | text |
| `Text` | `tone`, `size` | text, `Bold`, `Code` |
| `Bold` | none | text, `Code` (only inside `Text`) |
| `Code` | none | text (only inside `Text` or `Bold`) |
| `List` | `items`* (text or numbers), `ordered`, `gap`, `tone` | none |
| `Badge` | `tone`, `label` | text |
| `Stat` | `label`*, `value`*, `format`, `caption`, `tone`, `trend`, `trendFormat`, `trendTone` | none |
| `Table` | `columns`*, `rows`* (cells: text, numbers, or `{ kind: "badge", label, tone }`), `caption` | none |
| `Progress` | `label`*, `value`*, `max`, `tone` | none |
| `BarChart` | `label`*, `data`* (`[{ label, value }]`), `tone`, `height` | none |
| `Sparkline` | `label`*, `data`* (`[{ label, value }]`), `tone`, `height` | none |
| `Donut` | `label`*, `data`* (`[{ label, value, tone }]`), `size` | none |
| `Slider` | `bind`*, `label`*, `min`, `max`, `step`, `format` | none |
| `Select` | `bind`*, `label`*, `options`* | none |
| `Toggle` | `bind`*, `label`* | none |
| `Tabs` | `bind`* (text State), `label`*, `orientation`, `size` | `Tab` only |
| `Tab` | `value`* (fixed text), `label`* | components (only inside `Tabs`) |
| `TextInput` | `bind`* (text State), `label`*, `placeholder`, `description`, `disabled`, `maxLength` (1–2048, fixed) | none |
| `Button` | `set` + `to`, or `prefill`; `label`, `variant` | text |
| `State` | `name`*, `initial`* | none |

\* required. `BarChart` reuses `src/components/ui/charts/bar-chart.tsx`, `Sparkline` reuses `src/components/ui/sparkline.tsx` (its sheet, `src/styles/sparkline.css`, is imported by that component) and `Donut` reuses `src/components/ui/charts/donut-chart.tsx`. `Select` reuses `StandardSelect`. `Button` reuses the shared `Button`.

`Grid` and `Columns` are two spellings of one layout. In a pane narrower than 28rem, three or four columns become two; below 18rem every grid stacks to one column. `Divider` is an `hr`, and `List` is a native `ul` (or `ol` with `ordered`) whose items are plain text. `Callout` is a `role="note"` region: an icon and an assistive label ("Note", "Success", "Warning" or "Important") carry its tone, so colour is never the only signal. A `Stat` trend reads as text ("+12% increase", "−0.8 decrease", "0 unchanged") with a decorative arrow, and `trendTone` defaults to `neutral`: rising is never assumed to be good. Table badge cells take exactly `kind`, `label` and an optional `tone`. `Sparkline` points and `Donut` slices take exactly the listed keys, with unique labels and finite values; donut values can't be negative. Both charts keep a caption and the values in text: a screen-reader list for the sparkline, and a visible legend with shares for the donut. A slice without a tone takes the next default tone that no other slice is using (accent, success, warning, danger, muted, then info, which shares accent's hue in some palettes), and an empty donut says "No data yet". `Tabs` reuses the shared `Tabs` (`src/components/ui/tabs.tsx`) for roving focus and selection. Its tab ids are positional, so a value with spaces never reaches an id reference, and one focusable `tabpanel` shows the selected tab. It holds 1–12 `Tab` children with unique fixed values. Once the tag closes, its State must start on one of them; while streaming, that check waits. If State later leaves the tab values (a `Button` can set it), `Tabs` becomes a chip and every tab reads as a labelled section. `TextInput` reuses `Field` and `TextInput` with explicit props only: it binds a text State, starts within `maxLength` (2,048 when unset), and clamps typing to it. It has no form, name, type, action or submit, so text only ever reaches local State or a `prefill`. `Bold` and `Code` are the whole inline grammar. They render as `strong` and `code`, take no props, and are errors anywhere else. Lower-case tags such as `<b>` stay errors, and text that looks like a tag stays text.

Token props accept names only. The values live in `src/styles/chat-ui-block.css`:

- `gap`: `none`, `xs`, `sm`, `md`, `lg` → `--space-*`
- `tone`: `neutral`, `muted`, `accent`, `success`, `warning`, `danger`, `info` → `--text-*`, `--accent-presence`, `--color-*` through the tint recipe
- `format`: `number`, `usd`, `eur`, `gbp`, `percent` (the value is already a percentage), `compact`

`style`, `className`, `class` and every `on*` handler are rejected per node.

## Expressions

Expressions are parsed into a small AST and walked by `evaluateUiExpression` in `src/lib/ui-blocks.ts`. Nothing is passed to `eval`, `Function`, a Worker or an iframe.

Allowed:

- numbers, text, `true`, `false`, `null`
- lists `[…]` and objects `{ key: value }` (`__proto__`, `constructor` and `prototype` keys are refused)
- State names
- `+ - * / %`, `< <= > >=`, `== != === !==`, `&& || !`, and `?:`

Rejected at parse time: function calls, property access, indexing, assignment, arrow functions, template strings, statements, and expressions nested more than 32 levels deep. Any name that isn't a State declared **above** the expression is an error. Declare-before-use keeps the streamed tree monotonic: a later declaration can't change the meaning of a node that has already rendered. Lookups use `Object.hasOwn`, so `toString`, `constructor` and similar names never reach the prototype chain. A non-finite result (like `1 / 0`) is an error, not `Infinity`.

## Authority

A `Button` does exactly one thing:

- `set="seats" to={10}` sets local State, or
- `prefill="text"` appends the text to this chat's composer (below any existing draft) and focuses it. Nothing is sent. ChatView announces "Draft added to the composer. Nothing was sent."

There is no send, link, fetch, file, or submit action in the catalog. This follows the approve card's rule that selecting doesn't send. Prefill reaches the composer only through `UiBlockHostContext`, which ChatView provides per pane. A read-only chat provides `prefill: null`, and its prefill buttons render disabled.

## Streaming

Each chunk re-parses the whole block so far (`buildUiBlock(source, { streaming: true })`):

- Open tags auto-close.
- A trailing partial tag, attribute, closing tag or `{expression}` is dropped. The node appears only once its tag is complete, so props never flicker. A half-arrived tag for a known component shows a skeleton placeholder in place, except inside a line of text (`Text`, `Heading`, `Badge`, `Button`, `Bold`, `Code`), where nothing shows until the tag completes.
- Rules that depend on children (a Button needs a label) wait for the closing tag.
- Node ids count elements only, so whitespace churn never re-keys a component.
- State is keyed by block ordinal and `State name` within a mounted turn or timeline text span. User changes survive every re-parse and the streaming-to-settled renderer swap. Separate blocks, spans and turns have independent state; leaving the mounted turn discards its state.
- `uiFenceBody` hides a half-arrived closing fence, and a half-written opener (```` ```coven:u ````) renders nothing instead of flashing.

`src/lib/ui-blocks.test.ts` feeds every prefix of each fixture through the parser. It asserts no throw, no source fallback, no truncation chip, no error flash on valid fixtures, and that every node, once rendered, keeps its type and props. It also checks that the final streamed tree equals the settled tree.

## Failure isolation

A failed node renders an inline chip (`role="note"`, "Couldn't render &lt;label&gt;: &lt;issues&gt;"). Its validated children follow the chip in reading order, and its siblings still render. This applies to each kind of failure below (#6067). The children are the same validated text, expressions and components used everywhere else, never raw HTML. The text of an inline component (Heading, Text, Badge, Button) stays on one line beneath its chip.

- **Build time:** an unknown component, unknown prop, bad prop type, unparseable or undeclared expression, or illegal child turns that node into an error chip. A lower-case tag such as `<script>` or `<img>` is an unknown component. Two cases render the chip only: a node past the nesting cap, and text inside a component that takes no children, where the text itself is the failure.
- **Render time:** `resolveUiProps` evaluates expressions against current State. A failure, such as a dynamic `tone` outside the token list, becomes a chip for that node only, with its children after it.
- **Exceptions:** each component renders inside its own error boundary. A component that throws renders the chip, then its children, each inside its own boundary.
- **Total failure:** a body with no markup (JSON or prose) falls back to its source as a code block.
- **Settled blocks only:** a block that ends early or leaves tags open renders what it has, plus one block-level note.

Caps: 20,000 characters per block, 400 components, 24 levels of nesting, 100 table rows, 12 columns, 40 bars, 50 options, 100 list items, 40 sparkline points, 12 donut slices, 12 tabs, 2,048 characters per text input.

## Where it is wired

- **Settled turns:** `splitSegmentsForUiBlocks` in `src/components/chat-ui-block.tsx` runs innermost in the `richProseSegments` chain, so no other splitter sees the markup. `sliceUiBlocks` honours an opener only at the start of a fenced range (`fencedRanges`), and never indented under an open list item (CommonMark continuation, Val's decision on #6060), so a `coven:ui` example inside another fence, a list item, a quote, or indented code stays literal.
- **Streaming turns:** `StreamingMarkdownBlocks` (`src/components/streaming-markdown-blocks.tsx`) renders a fence block through `ChatUiBlock`, but only inside a `UiBlockHostContext` provider, and only when `isLiveUiFenceAfter` agrees with the settled rule for the text before the block. ChatView is the only provider, so Quick Chat, which reuses the same streaming component, gets no native blocks. Streaming block ids end in the block's growing end offset, so the renderer is keyed by the block's start (`stableUiBlockKey`) and stays mounted, with its State, from the opener to the closing fence.
- **Readable fallback (#6060):** surfaces without the native tier show `src/lib/ui-block-readable.ts`'s projection instead of raw markup: one plain line per item, evaluated at each State's initial value, with buttons as `[label]` and nothing that runs, sends, prefills or links. It reads only the parser's output, so it never disagrees with Main Chat about which fences are live. `src/lib/ui-block-fallback-fixtures.ts` holds the rules and the shared cases every surface tests. Quick Chat renders settled blocks through `UiBlockReadable` as plain text (never markdown) and copies the same lines; while a reply streams, its blocks are held back, like GitHub cards. The expanded reader renders its body as markdown segments around each block's `UiBlockReadable`, and its Copy and Markdown export hand back the readable lines. Main Chat's turn Copy and a response's Copy do the same, while the transcript itself keeps rendering blocks natively. iOS runs the same TypeScript module rather than a port: `apps/ios/markdown/entry.mjs` renders each block as readable lines, and `scripts/build-ios-markdown.mjs` also bundles the projection into `Resources/ui-block-readable.js`, which `UiBlockReadableText.swift` runs in JavaScriptCore for every Copy. `CovenCaveTests/Fixtures/ui-block-fallback-v1.json` mirrors the corpus (`scripts/write-ui-block-fallback-fixture.mjs` regenerates it, and a TypeScript test fails while it differs), and the Swift tests run every case through both the page and Copy.
- **Durability:** blocks render from the saved chat text, like HTML artifacts. Nothing extra is persisted.

## Familiar prompt rollout

The prompt change from spike #5931 is excluded. Familiar selection and rollout
require Val's decision on #5947 and a separate change.

## Not in v0

Worker runtime, server-side compile, JSON-Patch transport, an AppBlock equivalent, interactive iOS or Quick Chat rendering, and any change to canvas artifacts. Quick Chat, the expanded reader and iOS show the readable fallback instead.

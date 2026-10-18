# Native UI tier for chat (`coven:ui`)

Status: parser and renderer under review for #5947. Familiar prompt changes are a separate follow-up; this change teaches no familiar the syntax.

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

## Catalog (v0)

| Component | Props | Children |
| --- | --- | --- |
| `Stack` | `gap`, `align` | components |
| `Row` | `gap`, `align`, `justify`, `wrap` | components |
| `Card` | `title`, `subtitle`, `tone`, `gap` | components |
| `Heading` | `level` (1–4) | text |
| `Text` | `tone`, `size` | text |
| `Badge` | `tone`, `label` | text |
| `Stat` | `label`*, `value`*, `format`, `caption`, `tone` | none |
| `Table` | `columns`*, `rows`*, `caption` | none |
| `Progress` | `label`*, `value`*, `max`, `tone` | none |
| `BarChart` | `label`*, `data`* (`[{ label, value }]`), `tone`, `height` | none |
| `Slider` | `bind`*, `label`*, `min`, `max`, `step`, `format` | none |
| `Select` | `bind`*, `label`*, `options`* | none |
| `Toggle` | `bind`*, `label`* | none |
| `Button` | `set` + `to`, or `prefill`; `label`, `variant` | text |
| `State` | `name`*, `initial`* | none |

\* required. `BarChart` reuses `src/components/ui/charts/bar-chart.tsx`. `Select` reuses `StandardSelect`. `Button` reuses the shared `Button`.

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
- A trailing partial tag, attribute, closing tag or `{expression}` is dropped. The node appears only once its tag is complete, so props never flicker. A half-arrived tag for a known component shows a skeleton placeholder in place.
- Rules that depend on children (a Button needs a label) wait for the closing tag.
- Node ids count elements only, so whitespace churn never re-keys a component.
- State is keyed by block ordinal and `State name` within a mounted turn or timeline text span. User changes survive every re-parse and the streaming-to-settled renderer swap. Separate blocks, spans and turns have independent state; leaving the mounted turn discards its state.
- `uiFenceBody` hides a half-arrived closing fence, and a half-written opener (```` ```coven:u ````) renders nothing instead of flashing.

`src/lib/ui-blocks.test.ts` feeds every prefix of each fixture through the parser. It asserts no throw, no source fallback, no truncation chip, no error flash on valid fixtures, and that every node, once rendered, keeps its type and props. It also checks that the final streamed tree equals the settled tree.

## Failure isolation

- **Build time:** an unknown component, unknown prop, bad prop type, unparseable or undeclared expression, or illegal child turns that node into an error chip. Its children still render, and so do its siblings.
- **Render time:** `resolveUiProps` evaluates expressions against current State. A failure, such as a dynamic `tone` outside the token list, becomes a chip for that node only.
- **Exceptions:** each component renders inside its own error boundary.
- **Total failure:** a body with no markup (JSON or prose) falls back to its source as a code block.
- **Settled blocks only:** a block that ends early or leaves tags open renders what it has, plus one block-level note.

Caps: 20,000 characters per block, 400 components, 24 levels of nesting, 100 table rows, 12 columns, 40 bars, 50 options.

## Where it is wired

- **Settled turns:** `splitSegmentsForUiBlocks` in `src/components/chat-ui-block.tsx` runs innermost in the `richProseSegments` chain, so no other splitter sees the markup. `sliceUiBlocks` honours an opener only at the start of a fenced range (`fencedRanges`), so a `coven:ui` example inside another fence, a list item, a quote, or indented code stays literal.
- **Streaming turns:** `StreamingMarkdownBlocks` (`src/components/streaming-markdown-blocks.tsx`) renders a fence block through `ChatUiBlock`, but only inside a `UiBlockHostContext` provider. ChatView is the only provider, so Quick Chat, which reuses the same streaming component, is unchanged. Streaming block ids end in the block's growing end offset, so the renderer is keyed by the block's start (`stableUiBlockKey`) and stays mounted, with its State, from the opener to the closing fence.
- **Durability:** blocks render from the saved chat text, like HTML artifacts. Nothing extra is persisted.

## Familiar prompt rollout

The prompt change from spike #5931 is excluded. Familiar selection and rollout
require Val's decision on #5947 and a separate change.

## Not in v0

Worker runtime, server-side compile, JSON-Patch transport, an AppBlock equivalent, iOS rendering, Quick Chat rendering, and any change to canvas artifacts. On those surfaces a `coven:ui` fence renders as an ordinary code block.

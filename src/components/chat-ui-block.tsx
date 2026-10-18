"use client";

/**
 * ChatUiBlock — the renderer for `coven:ui` blocks (native UI tier).
 *
 * src/lib/ui-blocks.ts parses and validates the markup; this file maps each
 * validated node to Cave's own components and token classes
 * (src/styles/chat-ui-block.css). It never evaluates model text as code:
 * every value comes from `resolveUiProps` / `evaluateUiExpression`.
 *
 * - State belongs to the enclosing turn/text-span scope, keyed by block ordinal
 *   and State name, so interaction survives re-parses and settlement remounts.
 * - Each node renders inside its own error boundary; a failing node becomes
 *   an inline error chip and its siblings still render.
 * - A Button may set local State or prefill the composer through
 *   UiBlockHostContext. Nothing here sends a message, fetches, or links.
 */

import "@/styles/chat-ui-block.css";

import {
  Component,
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { BarChart } from "@/components/ui/charts/bar-chart";
import { StandardSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/lib/icon";
import {
  buildUiBlock,
  sliceUiBlocks,
  evaluateUiExpression,
  formatUiValue,
  resolveUiProps,
  uiBlockStateValues,
  type UiBlockDocument,
  type UiComponentNode,
  type UiNode,
  type UiPrimitive,
  type UiValue,
} from "@/lib/ui-blocks";
import { ProgressiveMarkdownBlock, type MessageBubbleSegment } from "./message-bubble";

/** Puts text in the chat composer for the person to review. It never sends. */
export type UiBlockPrefill = (text: string) => void;

/**
 * Provided by ChatView, the only surface that opts into the native UI tier.
 * Without a host (Quick Chat, readers), streamed coven:ui fences stay ordinary
 * code blocks. `prefill` is null where there is no composer to fill.
 */
export type UiBlockHost = { prefill: UiBlockPrefill | null; announce?: (message: string) => void };
export const UiBlockHostContext = createContext<UiBlockHost | null>(null);

type BlockOverrides = Record<string, UiPrimitive>;
const EMPTY_OVERRIDES: BlockOverrides = {};

function createUiStateStore() {
  const blocks = new Map<number, BlockOverrides>();
  const listeners = new Set<() => void>();
  return {
    read: (block: number) => blocks.get(block) ?? EMPTY_OVERRIDES,
    write(block: number, name: string, value: UiPrimitive) {
      blocks.set(block, { ...blocks.get(block), [name]: value });
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const UiBlockStateContext = createContext<ReturnType<typeof createUiStateStore> | null>(null);

/** Retain local interaction across the streaming/settled subtree swap.
 * Mount once per turn (or ordered transcript text span), keyed by its identity.
 * Nothing is persisted outside that mounted scope.
 */
export function UiBlockStateScope({ children }: { children: ReactNode }) {
  const [store] = useState(createUiStateStore);
  return <UiBlockStateContext.Provider value={store}>{children}</UiBlockStateContext.Provider>;
}

type RenderContext = {
  values: Record<string, UiPrimitive>;
  setValue: (name: string, value: UiPrimitive) => void;
  prefill: UiBlockPrefill | null;
  announce?: (message: string) => void;
};

const CHART_HEIGHT = { sm: 120, md: 160, lg: 220 } as const;

const TONE_FILL: Record<string, string> = {
  neutral: "var(--text-muted)",
  muted: "var(--text-muted)",
  accent: "var(--accent-presence)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  info: "var(--color-info)",
};

function text(value: UiValue | undefined): string {
  return value === undefined ? "" : formatUiValue(value);
}

function errorLabel(label: string): string {
  return label === "text" || label === "expression" ? `this ${label}` : `<${label}>`;
}

export function UiBlockErrorChip({ label, issues }: { label: string; issues: string[] }) {
  return (
    <span className="chat-ui-error" role="note" data-ui-block-error={label}>
      <Icon name="ph:warning-circle" width={13} aria-hidden />
      <span>
        <span className="chat-ui-error__lead">{`Couldn't render ${errorLabel(label)}: `}</span>
        {issues.join("; ")}
      </span>
    </span>
  );
}

class UiNodeBoundary extends Component<
  { label: string; resetKey: string; children: ReactNode },
  { failed: string | null; resetKey: string }
> {
  state = { failed: null as string | null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { failed: error instanceof Error ? error.message : "Rendering failed" };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { failed: string | null; resetKey: string },
  ) {
    return props.resetKey === state.resetKey ? null : { failed: null, resetKey: props.resetKey };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Isolated by design: the chip below is the whole report.
  }

  render() {
    if (this.state.failed) {
      return <UiBlockErrorChip label={this.props.label} issues={[this.state.failed]} />;
    }
    return this.props.children;
  }
}

function renderNodes(nodes: UiNode[], ctx: RenderContext, inline: boolean): ReactNode[] {
  return nodes.map((node) => <UiNodeView key={node.id} node={node} ctx={ctx} inline={inline} />);
}

function UiNodeView({ node, ctx, inline }: { node: UiNode; ctx: RenderContext; inline: boolean }) {
  switch (node.kind) {
    case "text":
      return inline ? <>{node.text}</> : <p className="chat-ui-text">{node.text}</p>;
    case "expr": {
      const result = evaluateUiExpression(node.expr, ctx.values);
      if (!result.ok) return <UiBlockErrorChip label="expression" issues={[result.error]} />;
      if (Array.isArray(result.value) || (result.value !== null && typeof result.value === "object")) {
        return <UiBlockErrorChip label="expression" issues={["A list or object can't be shown as text"]} />;
      }
      const value = formatUiValue(result.value);
      return inline ? <>{value}</> : <p className="chat-ui-text">{value}</p>;
    }
    case "pending":
      return (
        <span className="chat-ui-pending" data-ui-block-pending={node.type}>
          <Skeleton variant={node.type === "Table" || node.type === "BarChart" ? "card" : "text"} />
        </span>
      );
    case "error":
      return (
        <>
          <UiBlockErrorChip label={node.label} issues={node.issues} />
          {renderNodes(node.children, ctx, inline)}
        </>
      );
    case "component":
      return (
        <UiNodeBoundary label={node.type} resetKey={JSON.stringify(ctx.values)}>
          <UiComponentView node={node} ctx={ctx} />
        </UiNodeBoundary>
      );
    default:
      return null;
  }
}

function UiComponentView({ node, ctx }: { node: UiComponentNode; ctx: RenderContext }) {
  const id = useId();
  if (node.type === "State") return null;
  const resolved = resolveUiProps(node, ctx.values);
  if (!resolved.ok) {
    return (
      <>
        <UiBlockErrorChip label={node.type} issues={resolved.issues} />
        {renderNodes(node.children, ctx, false)}
      </>
    );
  }
  const props = resolved.props;
  const blocks = () => renderNodes(node.children, ctx, false);
  const inline = () => renderNodes(node.children, ctx, true);

  switch (node.type) {
    case "Stack":
      return (
        <div className="chat-ui-stack" data-gap={text(props.gap)} data-align={text(props.align)}>
          {blocks()}
        </div>
      );
    case "Row":
      return (
        <div
          className="chat-ui-row"
          data-gap={text(props.gap)}
          data-align={text(props.align)}
          data-justify={text(props.justify)}
          data-wrap={props.wrap === false ? "false" : "true"}
        >
          {blocks()}
        </div>
      );
    case "Card": {
      const title = text(props.title);
      const subtitle = text(props.subtitle);
      return (
        <section
          className="chat-ui-card"
          data-tone={text(props.tone)}
          aria-labelledby={title ? `${id}-title` : undefined}
        >
          {title || subtitle ? (
            <header className="chat-ui-card__header">
              {title ? <h3 id={`${id}-title`} className="chat-ui-card__title">{title}</h3> : null}
              {subtitle ? <p className="chat-ui-card__subtitle">{subtitle}</p> : null}
            </header>
          ) : null}
          <div className="chat-ui-stack" data-gap={text(props.gap)} data-align="stretch">
            {blocks()}
          </div>
        </section>
      );
    }
    case "Heading": {
      const level = Number(props.level) || 2;
      const Tag = (["h3", "h4", "h5", "h6"] as const)[Math.min(Math.max(level, 1), 4) - 1];
      return <Tag className="chat-ui-heading" data-level={String(level)}>{inline()}</Tag>;
    }
    case "Text":
      return (
        <p className="chat-ui-text" data-tone={text(props.tone)} data-size={text(props.size)}>
          {inline()}
        </p>
      );
    case "Badge":
      return (
        <span className="chat-ui-badge" data-tone={text(props.tone)}>
          {node.children.length ? inline() : text(props.label)}
        </span>
      );
    case "Stat":
      return (
        <div className="chat-ui-stat" data-tone={text(props.tone)}>
          <span className="chat-ui-stat__label">{text(props.label)}</span>
          <span className="chat-ui-stat__value">{formatUiValue(props.value ?? null, text(props.format))}</span>
          {props.caption !== undefined ? <span className="chat-ui-stat__caption">{text(props.caption)}</span> : null}
        </div>
      );
    case "Table":
      return <UiTable columns={props.columns as UiValue[]} rows={props.rows as UiValue[][]} caption={text(props.caption)} />;
    case "Progress": {
      const max = props.max as number;
      const value = Math.min(Math.max(props.value as number, 0), max);
      return (
        <div className="chat-ui-progress" data-tone={text(props.tone)}>
          <div className="chat-ui-progress__head">
            <span id={`${id}-label`}>{text(props.label)}</span>
            <span className="chat-ui-progress__value">{`${Math.round((value / max) * 100)}%`}</span>
          </div>
          <progress className="chat-ui-progress__bar" value={value} max={max} aria-labelledby={`${id}-label`} />
        </div>
      );
    }
    case "BarChart": {
      const data = (props.data as Array<{ label: string; value: number }>).map((datum) => ({
        label: datum.label,
        value: datum.value,
      }));
      const tone = text(props.tone);
      return (
        <figure className="chat-ui-chart" data-tone={tone}>
          <figcaption className="chat-ui-chart__label">{text(props.label)}</figcaption>
          <BarChart
            data={data}
            height={CHART_HEIGHT[text(props.height) as keyof typeof CHART_HEIGHT] ?? CHART_HEIGHT.md}
            defaultColor={TONE_FILL[tone] ?? TONE_FILL.accent}
          />
          <ul className="sr-only">
            {data.map((datum) => (
              <li key={datum.label}>{`${datum.label}: ${formatUiValue(datum.value)}`}</li>
            ))}
          </ul>
        </figure>
      );
    }
    case "Slider": {
      const bind = String(props.bind);
      const current = ctx.values[bind];
      const value = typeof current === "number" ? current : Number(props.min);
      const formatted = formatUiValue(value, text(props.format));
      return (
        <div className="chat-ui-field">
          <div className="chat-ui-field__head">
            <label htmlFor={`${id}-input`} className="chat-ui-field__label">{text(props.label)}</label>
            <output htmlFor={`${id}-input`} className="chat-ui-field__value">{formatted}</output>
          </div>
          <input
            id={`${id}-input`}
            type="range"
            className="chat-ui-range focus-ring"
            min={props.min as number}
            max={props.max as number}
            step={props.step as number}
            value={value}
            aria-valuetext={formatted}
            onChange={(event) => ctx.setValue(bind, Number(event.currentTarget.value))}
          />
        </div>
      );
    }
    case "Select": {
      const bind = String(props.bind);
      const options = (props.options as UiValue[]).map((option) =>
        typeof option === "string"
          ? { value: option, label: option }
          : {
              value: String((option as Record<string, UiValue>).value),
              label: String((option as Record<string, UiValue>).label ?? (option as Record<string, UiValue>).value),
            });
      const label = text(props.label);
      return (
        <div className="chat-ui-field" data-field="select">
          <span id={`${id}-label`} className="chat-ui-field__label">{label}</span>
          <StandardSelect<string>
            label={label}
            value={String(ctx.values[bind] ?? "")}
            options={options}
            onChange={(next) => ctx.setValue(bind, next)}
          />
        </div>
      );
    }
    case "Toggle": {
      const bind = String(props.bind);
      const on = ctx.values[bind] === true;
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className="chat-ui-toggle focus-ring"
          onClick={() => ctx.setValue(bind, !on)}
        >
          <span className="chat-ui-toggle__track" data-on={on ? "true" : "false"} aria-hidden>
            <span className="chat-ui-toggle__knob" />
          </span>
          <span className="chat-ui-toggle__label">{text(props.label)}</span>
        </button>
      );
    }
    case "Button": {
      const label = node.children.length ? inline() : text(props.label);
      const variant = text(props.variant) as "primary" | "secondary" | "ghost";
      if (props.prefill !== undefined) {
        const draft = text(props.prefill);
        return (
          <Button
            variant={variant}
            size="sm"
            leadingIcon="ph:pencil-simple"
            data-ui-block-action="prefill"
            disabled={!ctx.prefill}
            title={ctx.prefill ? "Adds this text to the composer. Nothing is sent." : "Drafting isn't available here."}
            onClick={() => ctx.prefill?.(draft)}
          >
            {label}
          </Button>
        );
      }
      const target = String(props.set);
      const next = props.to as UiPrimitive;
      return (
        <Button
          variant={variant}
          size="sm"
          data-ui-block-action="set"
          onClick={() => {
            ctx.setValue(target, next);
            ctx.announce?.(`${target}: ${formatUiValue(next)}.`);
          }}
        >
          {label}
        </Button>
      );
    }
    default:
      return null;
  }
}

function UiTable({ columns, rows, caption }: { columns: UiValue[]; rows: UiValue[][]; caption: string }) {
  return (
    <div
      className="chat-ui-table-wrap focus-ring"
      role="region"
      aria-label={caption || "Table"}
      tabIndex={0}
    >
      <table className="chat-ui-table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column, index) => <th key={index} scope="col">{text(column)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((_, cellIndex) => {
                const cell = row[cellIndex] ?? null;
                return (
                  <td key={cellIndex} data-numeric={typeof cell === "number" ? "true" : undefined}>
                    {text(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function blockLabel(doc: UiBlockDocument): string {
  for (const node of doc.nodes) {
    if (node.kind === "component" && node.type === "Card" && node.props.title?.kind === "static") {
      return text(node.props.title.value);
    }
  }
  return "Interactive view";
}

function sourceFence(source: string): string {
  const longest = Math.max(2, ...(source.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}jsx\n${source}\n${fence}`;
}

export function ChatUiBlock({ source, streaming = false, blockIndex = 0 }: { source: string; streaming?: boolean; blockIndex?: number }) {
  const doc = useMemo(() => buildUiBlock(source, { streaming }), [source, streaming]);
  const scope = useContext(UiBlockStateContext);
  const [localStore] = useState(createUiStateStore);
  const store = scope ?? localStore;
  const overrides = useSyncExternalStore(
    store.subscribe,
    () => store.read(blockIndex),
    () => EMPTY_OVERRIDES,
  );
  const host = useContext(UiBlockHostContext);
  const values = uiBlockStateValues(doc.states, overrides);
  const ctx: RenderContext = {
    values,
    prefill: host?.prefill ?? null,
    announce: host?.announce,
    setValue: (name, value) => store.write(blockIndex, name, value),
  };

  if (doc.status === "fallback" || (doc.status === "empty" && !streaming)) {
    return (
      <div className="chat-ui-block chat-ui-block--fallback" data-ui-block="fallback">
        <UiBlockErrorChip
          label="block"
          issues={doc.diagnostics.length ? doc.diagnostics : ["This isn't coven:ui markup, so its source is shown instead"]}
        />
        <ProgressiveMarkdownBlock text={sourceFence(source)} showCaret={false} />
      </div>
    );
  }
  if (doc.status === "empty") {
    return (
      <div className="chat-ui-block" data-ui-block="empty" role="status" aria-label="Loading interactive view…">
        <Skeleton variant="text" />
      </div>
    );
  }
  return (
    <div
      className="chat-ui-block"
      role="group"
      aria-label={blockLabel(doc)}
      aria-busy={streaming || undefined}
      data-ui-block={streaming ? "streaming" : "settled"}
    >
      <div className="chat-ui-stack" data-gap="md" data-align="stretch">
        {renderNodes(doc.nodes, ctx, false)}
      </div>
      {doc.diagnostics.length ? <UiBlockErrorChip label="block" issues={doc.diagnostics} /> : null}
    </div>
  );
}

/**
 * Native UI tier (docs/chat-native-ui-tier.md): replace each top-level
 * ```coven:ui fence with a ChatUiBlock rendered from the saved turn text.
 * It runs innermost, so no later splitter ever sees the block's markup; a
 * coven:ui example inside another fence stays literal (sliceUiBlocks).
 */

export function splitSegmentsForUiBlocks(segments: MessageBubbleSegment[]): MessageBubbleSegment[] {
  let blockIndex = 0;
  return segments.flatMap<MessageBubbleSegment>((segment, segmentIndex) => {
    if (segment.kind !== "text") return [segment];
    const pieces = sliceUiBlocks(segment.text);
    if (pieces.length === 1 && pieces[0].kind === "text") return [segment];
    return pieces.flatMap<MessageBubbleSegment>((piece, pieceIndex) => {
      if (piece.kind === "text") {
        return piece.text.trim() ? [{ kind: "text" as const, text: piece.text }] : [];
      }
      return [{
        kind: "block" as const,
        key: `ui-${segmentIndex}-${pieceIndex}`,
        node: <ChatUiBlock source={piece.source} blockIndex={blockIndex++} />,
      }];
    });
  });
}

/**
 * Readable, non-interactive text for `coven:ui` blocks (#6060).
 *
 * Surfaces that don't draw the native UI tier (Quick Chat, the expanded
 * reader and Copy) show this projection instead of raw markup. It reads only
 * the parser's own output (sliceUiBlocks, buildUiBlock, resolveUiProps), so it
 * can't disagree with Main Chat about which fences are live or what a node
 * says. Nothing runs, sends or prefills: a Button is its label in brackets.
 * The rules and the shared cases live in ui-block-fallback-fixtures.ts.
 */

import {
  UI_BLOCK_CATALOG,
  UI_CALLOUT_LABELS,
  UI_TREND_WORDS,
  buildUiBlock,
  evaluateUiExpression,
  formatUiValue,
  isUiComponentType,
  resolveUiProps,
  sliceUiBlocks,
  uiBlockStateValues,
  uiTrendDirection,
  type UiComponentNode,
  type UiNode,
  type UiStateValues,
  type UiValue,
} from "./ui-blocks.ts";

export const UI_BLOCK_PARTLY_SHOWN = "(Some parts of this block couldn't be shown.)";
export const UI_BLOCK_ENDED_EARLY = "(This block ended early.)";

type Projection = { values: UiStateValues; lines: string[]; failed: boolean };

function text(value: UiValue | undefined): string {
  return value === undefined ? "" : formatUiValue(value);
}

function push(projection: Projection, line: string): void {
  const trimmed = line.trim();
  if (trimmed) projection.lines.push(trimmed);
}

function inlineText(nodes: UiNode[], projection: Projection): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += node.text;
        break;
      case "expr": {
        const result = evaluateUiExpression(node.expr, projection.values);
        if (!result.ok || (result.value !== null && typeof result.value === "object")) projection.failed = true;
        else out += formatUiValue(result.value);
        break;
      }
      case "error":
        projection.failed = true;
        out += inlineText(node.children, projection);
        break;
      case "component":
        if (!resolveUiProps(node, projection.values).ok) projection.failed = true;
        out += inlineText(node.children, projection);
        break;
      default:
        break;
    }
  }
  return out;
}

/** A failed node keeps its children readable; an inline component's text stays one line. */
function failedChildren(type: string, children: UiNode[], projection: Projection): void {
  projection.failed = true;
  if (isUiComponentType(type) && UI_BLOCK_CATALOG[type].children === "inline") {
    push(projection, inlineText(children, projection));
  } else {
    blockLines(children, projection);
  }
}

function series(label: string, entries: string[]): string {
  return entries.length ? `${label}: ${entries.join(", ")}` : label;
}

function cell(value: UiValue): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && value.kind === "badge") {
    return text(value.label);
  }
  return text(value);
}

function componentLines(node: UiComponentNode, projection: Projection): void {
  if (node.type === "State") return;
  const resolved = resolveUiProps(node, projection.values);
  if (!resolved.ok) {
    failedChildren(node.type, node.children, projection);
    return;
  }
  const props = resolved.props;
  const label = text(props.label);
  const children = () => blockLines(node.children, projection);
  switch (node.type) {
    case "Stack":
    case "Row":
    case "Grid":
    case "Columns":
      children();
      return;
    case "Card":
      push(projection, text(props.title));
      push(projection, text(props.subtitle));
      children();
      return;
    case "Heading":
    case "Text":
    case "Bold":
    case "Code":
      push(projection, inlineText(node.children, projection));
      return;
    case "Badge":
      push(projection, node.children.length ? inlineText(node.children, projection) : label);
      return;
    case "Button":
      push(projection, `[${(node.children.length ? inlineText(node.children, projection) : label).trim()}]`);
      return;
    case "Stat": {
      let line = `${label}: ${formatUiValue(props.value ?? null, text(props.format))}`;
      if (props.caption !== undefined) line += ` ${text(props.caption)}`;
      if (typeof props.trend === "number") {
        const direction = uiTrendDirection(props.trend);
        line += direction === "flat"
          ? ` (${UI_TREND_WORDS.flat})`
          : ` (${formatUiValue(Math.abs(props.trend), text(props.trendFormat))} ${UI_TREND_WORDS[direction]})`;
      }
      push(projection, line);
      return;
    }
    case "Table": {
      const columns = props.columns as UiValue[];
      push(projection, columns.map(text).join(" | "));
      for (const row of props.rows as UiValue[][]) {
        push(projection, columns.map((_, index) => cell(row[index] ?? null)).join(" | "));
      }
      push(projection, text(props.caption));
      return;
    }
    case "Progress": {
      const max = props.max as number;
      const value = Math.min(Math.max(props.value as number, 0), max);
      push(projection, `${label}: ${formatUiValue(value)} of ${formatUiValue(max)}`);
      return;
    }
    case "BarChart":
    case "Sparkline": {
      const data = props.data as Array<{ label: string; value: number }>;
      push(projection, series(label, data.map((point) => `${point.label} ${formatUiValue(point.value)}`)));
      return;
    }
    case "Donut": {
      const data = props.data as Array<{ label: string; value: number }>;
      const total = data.reduce((sum, slice) => sum + slice.value, 0);
      push(projection, series(label, data.map((slice) =>
        `${slice.label} ${formatUiValue(slice.value)}${total > 0 ? ` (${Math.round((slice.value / total) * 100)}%)` : ""}`)));
      return;
    }
    case "Slider": {
      const current = projection.values[String(props.bind)];
      const value = typeof current === "number" ? current : Number(props.min);
      push(projection, `${label}: ${formatUiValue(value, text(props.format))}`);
      return;
    }
    case "Select": {
      const current = String(projection.values[String(props.bind)] ?? "");
      const option = (props.options as UiValue[]).find((entry) =>
        typeof entry === "string" ? entry === current : String((entry as Record<string, UiValue>).value) === current);
      const shown = option === undefined || typeof option === "string"
        ? current
        : String((option as Record<string, UiValue>).label ?? current);
      push(projection, `${label}: ${shown}`);
      return;
    }
    case "Toggle":
      push(projection, `${label}: ${projection.values[String(props.bind)] === true ? "on" : "off"}`);
      return;
    case "TextInput": {
      const current = projection.values[String(props.bind)];
      push(projection, typeof current === "string" && current.trim() ? `${label}: ${current}` : label);
      return;
    }
    case "List": {
      const ordered = props.ordered === true;
      (props.items as UiValue[]).forEach((item, index) => push(projection, `${ordered ? `${index + 1}.` : "-"} ${text(item)}`));
      return;
    }
    case "Callout": {
      const word = UI_CALLOUT_LABELS[text(props.tone)];
      const title = text(props.title);
      push(projection, word && title ? `${word}: ${title}` : word ?? title);
      children();
      return;
    }
    case "Tabs": {
      const tabs = node.children.filter((child): child is UiComponentNode => child.kind === "component" && child.type === "Tab");
      const values = tabs.map((tab) => (tab.props.value?.kind === "static" ? String(tab.props.value.value) : ""));
      // Main Chat shows a chip when the bound State isn't one of the tabs.
      if (!values.includes(String(projection.values[String(props.bind)] ?? ""))) {
        failedChildren(node.type, node.children, projection);
        return;
      }
      push(projection, label);
      children();
      return;
    }
    case "Tab":
      push(projection, label);
      children();
      return;
    case "Divider":
    default:
      return;
  }
}

function blockLines(nodes: UiNode[], projection: Projection): void {
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        push(projection, node.text);
        break;
      case "expr":
        push(projection, inlineText([node], projection));
        break;
      case "error":
        failedChildren(node.label, node.children, projection);
        break;
      case "component":
        componentLines(node, projection);
        break;
      default:
        break;
    }
  }
}

/**
 * One active block as readable lines, evaluated at each State's initial
 * value. Null when the parser can't read the body: that block stays literal.
 */
export function uiBlockReadableLines(source: string, complete = true): string[] | null {
  const doc = buildUiBlock(source);
  if (doc.status === "fallback") return null;
  const projection: Projection = { values: uiBlockStateValues(doc.states, {}), lines: [], failed: false };
  blockLines(doc.nodes, projection);
  if (projection.failed || doc.capped) projection.lines.push(UI_BLOCK_PARTLY_SHOWN);
  if (!complete || doc.endedEarly) projection.lines.push(UI_BLOCK_ENDED_EARLY);
  return projection.lines;
}

export type UiReadablePiece = { kind: "text"; text: string } | { kind: "ui"; lines: string[] };

/**
 * Split prose on live ```coven:ui blocks, each projected to readable lines.
 * Examples in other fences, list items, quotes or indented code, and bodies
 * the parser can't read, stay text exactly as written. While a reply streams,
 * an unterminated last block is held back until it closes.
 */
export function sliceReadableUiBlocks(text: string, options: { streaming?: boolean } = {}): UiReadablePiece[] {
  const pieces: UiReadablePiece[] = [];
  for (const piece of sliceUiBlocks(text)) {
    if (piece.kind === "text") {
      pieces.push(piece);
      continue;
    }
    if (options.streaming && !piece.complete) continue;
    const lines = uiBlockReadableLines(piece.source, piece.complete);
    pieces.push(lines === null ? { kind: "text", text: piece.raw } : { kind: "ui", lines });
  }
  return pieces;
}

/** The message as plain text, each live block replaced by its readable lines (Copy). */
export function projectUiBlocksToReadable(text: string, options: { streaming?: boolean } = {}): string {
  return sliceReadableUiBlocks(text, options)
    .map((piece) => (piece.kind === "text" ? piece.text : piece.lines.join("\n")))
    .join("");
}

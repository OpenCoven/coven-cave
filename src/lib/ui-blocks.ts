/**
 * Native UI tier for Cave chat (`coven:ui` blocks).
 *
 * A familiar emits a fenced block of JSX-like markup:
 *
 *   ```coven:ui
 *   <Card title="Seat pricing">
 *     <State name="seats" initial={8} />
 *     <Slider bind="seats" min={1} max={50} label="Seats" />
 *     <Stat label="Monthly" value={seats * 29} format="usd" />
 *   </Card>
 *   ```
 *
 * This module is the pure half: fence detection, a tolerant markup parser
 * that re-parses the whole prefix on every streamed chunk, a validator
 * against a closed component catalog, and a whitelisted expression
 * evaluator. Nothing here executes model-authored code: expressions are
 * parsed into a small AST (literals, declared State names, arithmetic,
 * comparison, logic, ternary, array and object literals) and walked by
 * `evaluateUiExpression`. There are no calls, no member access and no other
 * identifiers, so there is nothing to sandbox.
 *
 * The renderer lives in src/components/chat-ui-block.tsx. The design note is
 * docs/chat-native-ui-tier.md.
 */

import { fencedRanges } from "./github-blocks.ts";

// ── values ─────────────────────────────────────────────────────────────────

export type UiPrimitive = number | string | boolean | null;
export type UiValue = UiPrimitive | UiValue[] | { [key: string]: UiValue };
export type UiStateValues = Readonly<Record<string, UiPrimitive>>;

export const UI_BLOCK_FENCE_INFO = "coven:ui";

/** Hard caps. A block over a cap degrades (fallback or error chip); it never throws. */
export const UI_BLOCK_LIMITS = {
  maxSourceLength: 20_000,
  maxNodes: 400,
  maxDepth: 24,
  maxExpressionLength: 2_000,
  maxExpressionDepth: 32,
  maxTableRows: 100,
  maxTableColumns: 12,
  maxChartBars: 40,
  maxSelectOptions: 50,
} as const;

// ── expressions ────────────────────────────────────────────────────────────

export type UiBinaryOperator =
  | "+" | "-" | "*" | "/" | "%"
  | "<" | "<=" | ">" | ">="
  | "==" | "!=" | "===" | "!=="
  | "&&" | "||";

export type UiExpr =
  | { kind: "literal"; value: UiPrimitive }
  | { kind: "state"; name: string }
  | { kind: "unary"; op: "-" | "+" | "!"; arg: UiExpr }
  | { kind: "binary"; op: UiBinaryOperator; left: UiExpr; right: UiExpr }
  | { kind: "conditional"; test: UiExpr; consequent: UiExpr; alternate: UiExpr }
  | { kind: "array"; items: UiExpr[] }
  | { kind: "object"; entries: Array<[string, UiExpr]> };

type UiResult<T> = { ok: true; value: T } | { ok: false; error: string };

class UiExpressionError extends Error {}

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "eof" };

const PUNCTUATORS = [
  "===", "!==", "==", "!=", "<=", ">=", "&&", "||",
  "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", "(", ")", "[", "]", "{", "}", ",",
];

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_WORDS = new Set(["true", "false", "null"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const match = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (!match) throw new UiExpressionError(`Unexpected "${ch}"`);
      const after = source[i + match[0].length];
      if (after !== undefined && /[A-Za-z_.]/.test(after)) {
        throw new UiExpressionError(`Unexpected "${match[0]}${after}"`);
      }
      tokens.push({ t: "num", v: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let value = "";
      let j = i + 1;
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          const next = source[j + 1];
          if (next === undefined) break;
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          j += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          break;
        }
        value += c;
        j += 1;
      }
      if (!closed) throw new UiExpressionError("Unterminated string");
      tokens.push({ t: "str", v: value });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      const word = match ? match[0] : ch;
      tokens.push({ t: "id", v: word });
      i += word.length;
      continue;
    }
    if (ch === ".") throw new UiExpressionError("Property access isn't allowed");
    if (ch === "`") throw new UiExpressionError("Template strings aren't allowed");
    if (ch === ";") throw new UiExpressionError("Only one expression is allowed");
    if (ch === "=" && source[i + 1] === ">") throw new UiExpressionError("Functions aren't allowed");
    if (ch === "=" && source[i + 1] !== "=") throw new UiExpressionError("Assignment isn't allowed (=)");
    const punctuator = PUNCTUATORS.find((p) => source.startsWith(p, i));
    if (!punctuator) throw new UiExpressionError(`Unexpected "${ch}"`);
    tokens.push({ t: "op", v: punctuator });
    i += punctuator.length;
  }
  tokens.push({ t: "eof" });
  return tokens;
}

function describe(token: Token): string {
  switch (token.t) {
    case "eof": return "end of expression";
    case "num": return String(token.v);
    case "str": return JSON.stringify(token.v);
    default: return `"${token.v}"`;
  }
}

class ExpressionParser {
  private index = 0;
  private depth = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): UiExpr {
    const expr = this.conditional();
    const rest = this.peek();
    if (rest.t !== "eof") {
      if (rest.t === "op" && rest.v === "(") throw new UiExpressionError("Function calls aren't allowed");
      throw new UiExpressionError(`Unexpected ${describe(rest)}`);
    }
    return expr;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private isOp(...ops: string[]): string | null {
    const token = this.peek();
    return token.t === "op" && ops.includes(token.v) ? token.v : null;
  }

  private expectOp(op: string): void {
    if (!this.isOp(op)) throw new UiExpressionError(`Expected "${op}" but found ${describe(this.peek())}`);
    this.index += 1;
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > UI_BLOCK_LIMITS.maxExpressionDepth) {
      throw new UiExpressionError("Expression is nested too deeply");
    }
  }

  private leave(): void {
    this.depth -= 1;
  }

  private conditional(): UiExpr {
    this.enter();
    const test = this.or();
    let result = test;
    if (this.isOp("?")) {
      this.index += 1;
      const consequent = this.conditional();
      this.expectOp(":");
      const alternate = this.conditional();
      result = { kind: "conditional", test, consequent, alternate };
    }
    this.leave();
    return result;
  }

  private binary(next: () => UiExpr, ops: UiBinaryOperator[]): UiExpr {
    let left = next();
    let op = this.isOp(...ops);
    while (op) {
      this.index += 1;
      const right = next();
      left = { kind: "binary", op: op as UiBinaryOperator, left, right };
      op = this.isOp(...ops);
    }
    return left;
  }

  private or = (): UiExpr => this.binary(this.and, ["||"]);
  private and = (): UiExpr => this.binary(this.equality, ["&&"]);
  private equality = (): UiExpr => this.binary(this.relational, ["===", "!==", "==", "!="]);
  private relational = (): UiExpr => this.binary(this.additive, ["<=", ">=", "<", ">"]);
  private additive = (): UiExpr => this.binary(this.multiplicative, ["+", "-"]);
  private multiplicative = (): UiExpr => this.binary(this.unary, ["*", "/", "%"]);

  private unary = (): UiExpr => {
    const op = this.isOp("!", "-", "+");
    if (op) {
      this.index += 1;
      this.enter();
      const arg = this.unary();
      this.leave();
      return { kind: "unary", op: op as "!" | "-" | "+", arg };
    }
    const primary = this.primary();
    if (this.isOp("(")) throw new UiExpressionError("Function calls aren't allowed");
    if (this.isOp("[")) throw new UiExpressionError("Indexing isn't allowed");
    return primary;
  };

  private primary(): UiExpr {
    const token = this.peek();
    if (token.t === "num" || token.t === "str") {
      this.index += 1;
      return { kind: "literal", value: token.v };
    }
    if (token.t === "id") {
      this.index += 1;
      if (token.v === "true") return { kind: "literal", value: true };
      if (token.v === "false") return { kind: "literal", value: false };
      if (token.v === "null") return { kind: "literal", value: null };
      return { kind: "state", name: token.v };
    }
    if (token.t === "op" && token.v === "(") {
      this.index += 1;
      const inner = this.conditional();
      this.expectOp(")");
      return inner;
    }
    if (token.t === "op" && token.v === "[") {
      this.index += 1;
      this.enter();
      const items: UiExpr[] = [];
      while (!this.isOp("]")) {
        items.push(this.conditional());
        if (!this.isOp(",")) break;
        this.index += 1;
      }
      this.expectOp("]");
      this.leave();
      return { kind: "array", items };
    }
    if (token.t === "op" && token.v === "{") {
      this.index += 1;
      this.enter();
      const entries: Array<[string, UiExpr]> = [];
      const seen = new Set<string>();
      while (!this.isOp("}")) {
        const keyToken = this.peek();
        if (keyToken.t !== "id" && keyToken.t !== "str") {
          throw new UiExpressionError(`Expected an object key but found ${describe(keyToken)}`);
        }
        const key = String(keyToken.v);
        if (FORBIDDEN_KEYS.has(key)) throw new UiExpressionError(`Key "${key}" isn't allowed`);
        if (seen.has(key)) throw new UiExpressionError(`Key "${key}" appears twice`);
        seen.add(key);
        this.index += 1;
        this.expectOp(":");
        entries.push([key, this.conditional()]);
        if (!this.isOp(",")) break;
        this.index += 1;
      }
      this.expectOp("}");
      this.leave();
      return { kind: "object", entries };
    }
    throw new UiExpressionError(`Unexpected ${describe(token)}`);
  }
}

export function parseUiExpression(source: string): { ok: true; expr: UiExpr } | { ok: false; error: string } {
  if (!source.trim()) return { ok: false, error: "Expression is empty" };
  if (source.length > UI_BLOCK_LIMITS.maxExpressionLength) {
    return { ok: false, error: "Expression is too long" };
  }
  try {
    return { ok: true, expr: new ExpressionParser(tokenize(source)).parse() };
  } catch (error) {
    if (error instanceof UiExpressionError) return { ok: false, error: error.message };
    return { ok: false, error: "Expression couldn't be read" };
  }
}

/** Every State name an expression reads, in first-use order. */
export function uiExpressionRefs(expr: UiExpr): string[] {
  const out: string[] = [];
  const visit = (node: UiExpr) => {
    switch (node.kind) {
      case "state":
        if (!out.includes(node.name)) out.push(node.name);
        return;
      case "unary":
        visit(node.arg);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "conditional":
        visit(node.test);
        visit(node.consequent);
        visit(node.alternate);
        return;
      case "array":
        node.items.forEach(visit);
        return;
      case "object":
        node.entries.forEach(([, value]) => visit(value));
        return;
      default:
        return;
    }
  };
  visit(expr);
  return out;
}

function truthy(value: UiValue): boolean {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) return true;
  return Boolean(value);
}

function isPrimitive(value: UiValue): value is UiPrimitive {
  return value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean";
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new UiExpressionError("Result isn't a finite number");
  return value;
}

function numbers(op: string, left: UiValue, right: UiValue): [number, number] {
  if (typeof left !== "number" || typeof right !== "number") {
    throw new UiExpressionError(`"${op}" needs two numbers`);
  }
  return [left, right];
}

function evaluateNode(node: UiExpr, state: UiStateValues): UiValue {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "state":
      if (!Object.hasOwn(state, node.name)) {
        throw new UiExpressionError(`"${node.name}" isn't a declared State`);
      }
      return state[node.name];
    case "unary": {
      const arg = evaluateNode(node.arg, state);
      if (node.op === "!") return !truthy(arg);
      if (typeof arg !== "number") throw new UiExpressionError(`"${node.op}" needs a number`);
      return node.op === "-" ? -arg : arg;
    }
    case "conditional":
      return truthy(evaluateNode(node.test, state))
        ? evaluateNode(node.consequent, state)
        : evaluateNode(node.alternate, state);
    case "array":
      return node.items.map((item) => evaluateNode(item, state));
    case "object": {
      const out: { [key: string]: UiValue } = {};
      for (const [key, value] of node.entries) out[key] = evaluateNode(value, state);
      return out;
    }
    case "binary":
      return evaluateBinary(node, state);
    default:
      throw new UiExpressionError("Unknown expression");
  }
}

function evaluateBinary(node: Extract<UiExpr, { kind: "binary" }>, state: UiStateValues): UiValue {
  if (node.op === "&&") {
    const left = evaluateNode(node.left, state);
    return truthy(left) ? evaluateNode(node.right, state) : left;
  }
  if (node.op === "||") {
    const left = evaluateNode(node.left, state);
    return truthy(left) ? left : evaluateNode(node.right, state);
  }
  const left = evaluateNode(node.left, state);
  const right = evaluateNode(node.right, state);
  switch (node.op) {
    case "+": {
      if (typeof left === "number" && typeof right === "number") return finite(left + right);
      const textual = (value: UiValue) => typeof value === "string" || typeof value === "number";
      if ((typeof left === "string" || typeof right === "string") && textual(left) && textual(right)) {
        return String(left) + String(right);
      }
      throw new UiExpressionError('"+" needs numbers or text');
    }
    case "-": {
      const [a, b] = numbers(node.op, left, right);
      return finite(a - b);
    }
    case "*": {
      const [a, b] = numbers(node.op, left, right);
      return finite(a * b);
    }
    case "/": {
      const [a, b] = numbers(node.op, left, right);
      return finite(a / b);
    }
    case "%": {
      const [a, b] = numbers(node.op, left, right);
      return finite(a % b);
    }
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const comparable = (typeof left === "number" && typeof right === "number")
        || (typeof left === "string" && typeof right === "string");
      if (!comparable) throw new UiExpressionError(`"${node.op}" compares two numbers or two texts`);
      const a = left as number | string;
      const b = right as number | string;
      if (node.op === "<") return a < b;
      if (node.op === "<=") return a <= b;
      if (node.op === ">") return a > b;
      return a >= b;
    }
    case "==":
    case "===":
    case "!=":
    case "!==": {
      if (!isPrimitive(left) || !isPrimitive(right)) {
        throw new UiExpressionError("Only numbers, text, true/false and null can be compared");
      }
      const equal = left === right;
      return node.op === "==" || node.op === "===" ? equal : !equal;
    }
    default:
      throw new UiExpressionError("Unknown operator");
  }
}

export function evaluateUiExpression(expr: UiExpr, state: UiStateValues): UiResult<UiValue> {
  try {
    return { ok: true, value: evaluateNode(expr, state) };
  } catch (error) {
    if (error instanceof UiExpressionError) return { ok: false, error: error.message };
    return { ok: false, error: "Expression couldn't be evaluated" };
  }
}

// ── catalog ────────────────────────────────────────────────────────────────

export const UI_TONES = ["neutral", "muted", "accent", "success", "warning", "danger", "info"] as const;
export const UI_GAPS = ["none", "xs", "sm", "md", "lg"] as const;
export const UI_FORMATS = ["number", "usd", "eur", "gbp", "percent", "compact"] as const;

export type UiFormat = (typeof UI_FORMATS)[number];

type PropType =
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "state"
  | "identifier"
  | "value"
  | "textList"
  | "options"
  | "rows"
  | "series";

export type UiPropSpec = {
  type: PropType;
  required?: boolean;
  default?: UiValue;
  values?: readonly string[];
};

/** blocks: may hold components and paragraphs; inline: text only; none: a leaf. */
type ChildPolicy = "blocks" | "inline" | "none";

export type UiComponentSpec = {
  children: ChildPolicy;
  props: Record<string, UiPropSpec>;
};

export const UI_COMPONENT_TYPES = [
  "Stack", "Row", "Card", "Heading", "Text", "Badge", "Stat", "Table", "Progress", "BarChart",
  "Slider", "Select", "Toggle", "Button", "State",
] as const;

export type UiComponentType = (typeof UI_COMPONENT_TYPES)[number];

const tone = (fallback: string): UiPropSpec => ({ type: "enum", values: UI_TONES, default: fallback });
const gap = (fallback: string): UiPropSpec => ({ type: "enum", values: UI_GAPS, default: fallback });
const format: UiPropSpec = { type: "enum", values: UI_FORMATS, default: "number" };

export const UI_BLOCK_CATALOG: Record<UiComponentType, UiComponentSpec> = {
  Stack: {
    children: "blocks",
    props: {
      gap: gap("md"),
      align: { type: "enum", values: ["start", "center", "end", "stretch"], default: "stretch" },
    },
  },
  Row: {
    children: "blocks",
    props: {
      gap: gap("sm"),
      align: { type: "enum", values: ["start", "center", "end", "baseline", "stretch"], default: "center" },
      justify: { type: "enum", values: ["start", "center", "end", "between"], default: "start" },
      wrap: { type: "boolean", default: true },
    },
  },
  Card: {
    children: "blocks",
    props: {
      title: { type: "text" },
      subtitle: { type: "text" },
      tone: tone("neutral"),
      gap: gap("md"),
    },
  },
  Heading: {
    children: "inline",
    props: { level: { type: "enum", values: ["1", "2", "3", "4"], default: "2" } },
  },
  Text: {
    children: "inline",
    props: {
      tone: tone("neutral"),
      size: { type: "enum", values: ["xs", "sm", "md", "lg"], default: "md" },
    },
  },
  Badge: {
    children: "inline",
    props: { tone: tone("neutral"), label: { type: "text" } },
  },
  Stat: {
    children: "none",
    props: {
      label: { type: "text", required: true },
      value: { type: "value", required: true },
      format,
      caption: { type: "text" },
      tone: tone("neutral"),
    },
  },
  Table: {
    children: "none",
    props: {
      columns: { type: "textList", required: true },
      rows: { type: "rows", required: true },
      caption: { type: "text" },
    },
  },
  Progress: {
    children: "none",
    props: {
      label: { type: "text", required: true },
      value: { type: "number", required: true },
      max: { type: "number", default: 100 },
      tone: tone("accent"),
    },
  },
  BarChart: {
    children: "none",
    props: {
      label: { type: "text", required: true },
      data: { type: "series", required: true },
      tone: tone("accent"),
      height: { type: "enum", values: ["sm", "md", "lg"], default: "md" },
    },
  },
  Slider: {
    children: "none",
    props: {
      bind: { type: "state", required: true },
      label: { type: "text", required: true },
      min: { type: "number", default: 0 },
      max: { type: "number", default: 100 },
      step: { type: "number", default: 1 },
      format,
    },
  },
  Select: {
    children: "none",
    props: {
      bind: { type: "state", required: true },
      label: { type: "text", required: true },
      options: { type: "options", required: true },
    },
  },
  Toggle: {
    children: "none",
    props: {
      bind: { type: "state", required: true },
      label: { type: "text", required: true },
    },
  },
  Button: {
    children: "inline",
    props: {
      label: { type: "text" },
      variant: { type: "enum", values: ["primary", "secondary", "ghost"], default: "secondary" },
      set: { type: "state" },
      to: { type: "value" },
      prefill: { type: "text" },
    },
  },
  State: {
    children: "none",
    props: {
      name: { type: "identifier", required: true },
      initial: { type: "value", required: true },
    },
  },
};

export function isUiComponentType(name: string): name is UiComponentType {
  return (UI_COMPONENT_TYPES as readonly string[]).includes(name);
}

// ── documents ──────────────────────────────────────────────────────────────

export type UiProp =
  | { kind: "static"; value: UiValue }
  | { kind: "expr"; expr: UiExpr; source: string };

export type UiComponentNode = {
  kind: "component";
  id: string;
  type: UiComponentType;
  props: Record<string, UiProp>;
  children: UiNode[];
};

export type UiNode =
  | UiComponentNode
  | { kind: "text"; id: string; text: string }
  | { kind: "expr"; id: string; expr: UiExpr; source: string }
  | { kind: "error"; id: string; label: string; issues: string[]; children: UiNode[] }
  | { kind: "pending"; id: string; type: UiComponentType };

export type UiStateDeclaration = { id: string; name: string; initial: UiPrimitive };

export type UiBlockDocument = {
  /** ok: render nodes · empty: nothing yet · fallback: show the source as code. */
  status: "ok" | "empty" | "fallback";
  nodes: UiNode[];
  states: UiStateDeclaration[];
  /** Block-level notes (truncation, mismatched tags, caps). One chip, below the block. */
  diagnostics: string[];
};

// ── markup parser ──────────────────────────────────────────────────────────

type RawAttrValue =
  | { kind: "string"; value: string }
  | { kind: "expr"; source: string }
  | { kind: "flag" }
  | { kind: "invalid"; reason: string };

type RawAttr = { name: string; value: RawAttrValue };

type RawElement = {
  kind: "element";
  name: string;
  attrs: RawAttr[];
  children: RawNode[];
  issues: string[];
  /** Over the node cap: parsed for tag balance, never rendered. */
  dropped: boolean;
  /** Self-closed or closed by a tag; false while its children may still stream. */
  closed: boolean;
};

type RawNode =
  | RawElement
  | { kind: "text"; text: string }
  | { kind: "expr"; source: string }
  | { kind: "pending"; name: string };

type ParsedMarkup = {
  roots: RawNode[];
  diagnostics: string[];
  truncated: boolean;
  unclosed: string[];
  elementCount: number;
};

/** Index of the `}` matching the `{` at `start`, aware of strings and comments; -1 if it never closes. */
function findBraceEnd(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
      if (j >= source.length) return -1;
      i = j + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 2;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

type OpenTagResult =
  | { kind: "tag"; element: RawElement; end: number; selfClosing: boolean }
  | { kind: "truncated"; name: string; nameComplete: boolean };

function parseOpenTag(source: string, start: number): OpenTagResult {
  const nameMatch = /^[A-Za-z][A-Za-z0-9_.-]*/.exec(source.slice(start + 1));
  const name = nameMatch ? nameMatch[0] : "";
  let i = start + 1 + name.length;
  if (i >= source.length) return { kind: "truncated", name, nameComplete: false };
  const element: RawElement = { kind: "element", name, attrs: [], children: [], issues: [], dropped: false, closed: false };
  const truncated = (): OpenTagResult => ({ kind: "truncated", name, nameComplete: true });
  const skipSpace = () => {
    while (i < source.length && /\s/.test(source[i])) i += 1;
  };

  while (true) {
    skipSpace();
    if (i >= source.length) return truncated();
    const ch = source[i];
    if (ch === ">") return { kind: "tag", element, end: i + 1, selfClosing: false };
    if (ch === "/") {
      if (i + 1 >= source.length) return truncated();
      if (source[i + 1] === ">") return { kind: "tag", element, end: i + 2, selfClosing: true };
      element.issues.push(`Unexpected "/" in <${name}>`);
      i += 1;
      continue;
    }
    if (ch === "{") {
      const end = findBraceEnd(source, i);
      if (end === -1) return truncated();
      element.issues.push("Spread attributes aren't supported");
      i = end + 1;
      continue;
    }
    const attrMatch = /^[A-Za-z_][A-Za-z0-9_:-]*/.exec(source.slice(i));
    if (!attrMatch) {
      element.issues.push(`Unexpected "${ch}" in <${name}>`);
      i += 1;
      continue;
    }
    const attrName = attrMatch[0];
    i += attrName.length;
    if (i >= source.length) return truncated();
    skipSpace();
    if (i >= source.length) return truncated();
    if (source[i] !== "=") {
      element.attrs.push({ name: attrName, value: { kind: "flag" } });
      continue;
    }
    i += 1;
    skipSpace();
    if (i >= source.length) return truncated();
    const quote = source[i];
    if (quote === '"' || quote === "'") {
      const close = source.indexOf(quote, i + 1);
      if (close === -1) return truncated();
      element.attrs.push({ name: attrName, value: { kind: "string", value: source.slice(i + 1, close) } });
      i = close + 1;
      continue;
    }
    if (quote === "{") {
      const end = findBraceEnd(source, i);
      if (end === -1) return truncated();
      element.attrs.push({ name: attrName, value: { kind: "expr", source: source.slice(i + 1, end) } });
      i = end + 1;
      continue;
    }
    const bare = /^[^\s>]+/.exec(source.slice(i));
    const raw = bare ? bare[0].replace(/\/$/, "") : "";
    i += raw.length || 1;
    if (i >= source.length) return truncated();
    element.attrs.push({
      name: attrName,
      value: { kind: "invalid", reason: `${attrName} needs a quoted value or {expression}` },
    });
  }
}

function parseMarkup(source: string, streaming: boolean): ParsedMarkup {
  const roots: RawNode[] = [];
  const stack: RawElement[] = [];
  const diagnostics: string[] = [];
  let truncated = false;
  let text = "";
  let elementCount = 0;
  let capped = false;
  let i = 0;

  const children = () => (stack.length ? stack[stack.length - 1].children : roots);
  const flush = () => {
    if (text) children().push({ kind: "text", text });
    text = "";
  };

  while (i < source.length) {
    const ch = source[i];
    if (ch === "<") {
      const next = source[i + 1];
      if (next === undefined) {
        truncated = true;
        break;
      }
      if (next === "!" && (source.startsWith("<!--", i) || "<!--".startsWith(source.slice(i)))) {
        const end = source.indexOf("-->", i + 4);
        if (end === -1) {
          truncated = true;
          break;
        }
        flush();
        i = end + 3;
        continue;
      }
      if (next === "/") {
        const close = source.indexOf(">", i + 2);
        if (close === -1) {
          truncated = true;
          break;
        }
        const name = source.slice(i + 2, close).trim();
        flush();
        closeElement(name, stack, diagnostics);
        i = close + 1;
        continue;
      }
      if (/[A-Za-z]/.test(next)) {
        const result = parseOpenTag(source, i);
        if (result.kind === "truncated") {
          flush();
          if (streaming && result.nameComplete && isUiComponentType(result.name) && result.name !== "State") {
            children().push({ kind: "pending", name: result.name });
          }
          truncated = true;
          i = source.length;
          break;
        }
        flush();
        const { element } = result;
        elementCount += 1;
        if (elementCount > UI_BLOCK_LIMITS.maxNodes || stack.some((open) => open.dropped)) {
          element.dropped = true;
          if (!capped) {
            capped = true;
            diagnostics.push(`Too many components (limit ${UI_BLOCK_LIMITS.maxNodes}); the rest are hidden.`);
          }
        } else {
          children().push(element);
        }
        if (result.selfClosing) element.closed = true;
        else stack.push(element);
        i = result.end;
        continue;
      }
      text += ch;
      i += 1;
      continue;
    }
    if (ch === "{") {
      const end = findBraceEnd(source, i);
      if (end === -1) {
        truncated = true;
        break;
      }
      flush();
      const inner = source.slice(i + 1, end);
      if (!/^\s*\/\*[\s\S]*\*\/\s*$/.test(inner)) children().push({ kind: "expr", source: inner });
      i = end + 1;
      continue;
    }
    text += ch;
    i += 1;
  }
  flush();

  return {
    roots,
    diagnostics,
    truncated,
    unclosed: stack.filter((element) => !element.dropped).map((element) => element.name),
    elementCount,
  };
}

function closeElement(name: string, stack: RawElement[], diagnostics: string[]): void {
  let index = -1;
  for (let j = stack.length - 1; j >= 0; j -= 1) {
    if (stack[j].name === name) {
      index = j;
      break;
    }
  }
  if (index === -1) {
    diagnostics.push(`Ignored a stray </${name}> with no open <${name}>.`);
    return;
  }
  for (let j = stack.length - 1; j > index; j -= 1) {
    diagnostics.push(`<${stack[j].name}> wasn't closed before </${name}>.`);
    stack[j].closed = true;
  }
  stack[index].closed = true;
  stack.length = index;
}

/**
 * HTML-like whitespace: formatting whitespace (anything containing a newline)
 * between tags disappears, a newline run inside text reads as one space, and
 * the first/last child is trimmed at the outer edge. Block parents also drop
 * whitespace-only runs; inline parents keep a single space between words.
 */
function normalizeText(children: RawNode[], inline: boolean): RawNode[] {
  const out: RawNode[] = [];
  children.forEach((child, index) => {
    if (child.kind !== "text") {
      out.push(child);
      return;
    }
    if (/^\s*$/.test(child.text) && (!inline || /[\r\n]/.test(child.text))) return;
    let text = child.text.replace(/[ \t]*(?:\r\n|\r|\n)\s*/g, " ");
    if (index === 0) text = text.replace(/^\s+/, "");
    if (index === children.length - 1) text = text.replace(/\s+$/, "");
    if (text) out.push({ kind: "text", text });
  });
  return out;
}

// ── validation ─────────────────────────────────────────────────────────────

type ValidationContext = {
  declared: Map<string, UiPrimitive>;
  states: UiStateDeclaration[];
  /** Child-dependent rules wait for the closing tag while streaming. */
  streaming: boolean;
};

const ROOT_POLICY: ChildPolicy = "blocks";

function childId(parentId: string, segment: string): string {
  return parentId ? `${parentId}.${segment}` : segment;
}

function primitiveKind(value: UiPrimitive): string {
  return value === null ? "null" : typeof value;
}

/** Type-check a resolved value against its spec. Returns an issue or null. */
function checkPropValue(type: UiComponentType, name: string, spec: UiPropSpec, value: UiValue, declared?: ReadonlyMap<string, UiPrimitive>): string | null {
  switch (spec.type) {
    case "text":
      return typeof value === "string" || typeof value === "number" ? null : `${name} needs text`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${name} needs a number, like ${name}={4}`;
    case "boolean":
      return typeof value === "boolean" ? null : `${name} needs true or false`;
    case "enum": {
      const values = spec.values ?? [];
      return (typeof value === "string" || typeof value === "number") && values.includes(String(value))
        ? null
        : `${name} must be one of ${values.join(", ")}`;
    }
    case "state":
      if (typeof value !== "string") return `${name} needs a State name in quotes`;
      if (declared && !declared.has(value)) return `${name}="${value}" doesn't name a State declared above it`;
      return null;
    case "identifier":
      return typeof value === "string" && IDENTIFIER_RE.test(value) && !RESERVED_WORDS.has(value)
        ? null
        : `${name} must be a plain name like seats or monthlyTotal`;
    case "value":
      return isPrimitive(value) ? null : `${name} must be a number, text, or true/false`;
    case "textList": {
      if (!Array.isArray(value)) return `${name} needs a list like ["A", "B"]`;
      if (value.length > UI_BLOCK_LIMITS.maxTableColumns) return `${name} has more than ${UI_BLOCK_LIMITS.maxTableColumns} entries`;
      return value.every((item) => typeof item === "string" || typeof item === "number") ? null : `${name} must list text`;
    }
    case "options": {
      if (!Array.isArray(value) || value.length === 0) return `${name} needs a list like ["A", "B"]`;
      if (value.length > UI_BLOCK_LIMITS.maxSelectOptions) return `${name} has more than ${UI_BLOCK_LIMITS.maxSelectOptions} options`;
      const ok = value.every((item) =>
        typeof item === "string"
        || (item !== null && typeof item === "object" && !Array.isArray(item)
          && typeof item.value === "string" && (item.label === undefined || typeof item.label === "string")));
      return ok ? null : `${name} must list text or { label, value } entries`;
    }
    case "rows": {
      if (!Array.isArray(value)) return `${name} needs a list of rows like [["a", 1]]`;
      if (value.length > UI_BLOCK_LIMITS.maxTableRows) return `${name} has more than ${UI_BLOCK_LIMITS.maxTableRows} rows`;
      const ok = value.every((row) => Array.isArray(row)
        && row.length <= UI_BLOCK_LIMITS.maxTableColumns
        && row.every((cell) => isPrimitive(cell)));
      return ok ? null : `${name} rows must be lists of numbers or text`;
    }
    case "series": {
      if (!Array.isArray(value)) return `${name} needs a list like [{ label: "Mon", value: 3 }]`;
      if (value.length > UI_BLOCK_LIMITS.maxChartBars) return `${name} has more than ${UI_BLOCK_LIMITS.maxChartBars} bars`;
      const labels = new Set<string>();
      for (const item of value) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) return `${name} entries need a label and a value`;
        if (typeof item.label !== "string" || typeof item.value !== "number" || !Number.isFinite(item.value)) {
          return `${name} entries need a text label and a number value`;
        }
        if (labels.has(item.label)) return `${name} labels must be unique ("${item.label}" repeats)`;
        labels.add(item.label);
      }
      return null;
    }
    default:
      return `${type} has an unsupported prop ${name}`;
  }
}

function validateProp(
  type: UiComponentType,
  attr: RawAttr,
  spec: UiPropSpec,
  ctx: ValidationContext,
): { prop?: UiProp; issue?: string } {
  const { value } = attr;
  if (value.kind === "invalid") return { issue: value.reason };
  if (value.kind === "flag") {
    return spec.type === "boolean"
      ? { prop: { kind: "static", value: true } }
      : { issue: `${attr.name} needs a value` };
  }
  if (value.kind === "string") {
    if (spec.type === "boolean" || spec.type === "number") {
      return { issue: `${attr.name} needs ${spec.type === "number" ? `a number, like ${attr.name}={4}` : "true or false, like " + attr.name + "={true}"}` };
    }
    const issue = checkPropValue(type, attr.name, spec, value.value, ctx.declared);
    return issue ? { issue } : { prop: { kind: "static", value: value.value } };
  }
  if (spec.type === "state" || spec.type === "identifier") {
    return { issue: `${attr.name} takes a plain name in quotes, like ${attr.name}="seats"` };
  }
  const parsed = parseUiExpression(value.source);
  if (!parsed.ok) return { issue: `${attr.name}: ${parsed.error}` };
  const refs = uiExpressionRefs(parsed.expr);
  const undeclared = refs.filter((ref) => !ctx.declared.has(ref));
  if (undeclared.length) {
    return { issue: `${attr.name}: "${undeclared[0]}" isn't a State declared above it` };
  }
  if (refs.length === 0) {
    // A constant expression folds at build time so it validates like a literal.
    const folded = evaluateUiExpression(parsed.expr, {});
    if (!folded.ok) return { issue: `${attr.name}: ${folded.error}` };
    const issue = checkPropValue(type, attr.name, spec, folded.value, ctx.declared);
    return issue ? { issue } : { prop: { kind: "static", value: folded.value } };
  }
  return { prop: { kind: "expr", expr: parsed.expr, source: value.source.trim() } };
}

function validateElement(
  raw: RawElement,
  id: string,
  depth: number,
  ctx: ValidationContext,
): UiNode {
  const childrenOf = (policy: ChildPolicy, type: string) =>
    validateChildren(raw.children, policy, type, id, depth + 1, ctx);

  if (depth >= UI_BLOCK_LIMITS.maxDepth) {
    return { kind: "error", id, label: raw.name, issues: [`Nested too deeply (limit ${UI_BLOCK_LIMITS.maxDepth} levels)`], children: [] };
  }
  if (!isUiComponentType(raw.name)) {
    return {
      kind: "error",
      id,
      label: raw.name,
      issues: [`Unknown component <${raw.name}>`],
      children: childrenOf("blocks", raw.name),
    };
  }

  const type = raw.name;
  const spec = UI_BLOCK_CATALOG[type];
  const issues = [...raw.issues];
  const props: Record<string, UiProp> = {};
  for (const attr of raw.attrs) {
    if (/^on[A-Z]/.test(attr.name)) {
      issues.push(`Event handlers aren't allowed (${attr.name})`);
      continue;
    }
    if (attr.name === "style" || attr.name === "className" || attr.name === "class") {
      issues.push(`${attr.name} isn't allowed; use token props like tone and gap`);
      continue;
    }
    const propSpec = spec.props[attr.name];
    if (!propSpec) {
      issues.push(`Unknown prop "${attr.name}" on <${type}>`);
      continue;
    }
    if (attr.name in props) {
      issues.push(`${attr.name} is set twice`);
      continue;
    }
    const result = validateProp(type, attr, propSpec, ctx);
    if (result.issue) issues.push(result.issue);
    else if (result.prop) props[attr.name] = result.prop;
  }
  for (const [name, propSpec] of Object.entries(spec.props)) {
    if (propSpec.required && !(name in props) && !raw.attrs.some((attr) => attr.name === name)) {
      issues.push(`<${type}> needs ${name}`);
    }
  }
  issues.push(...componentIssues(type, raw, props, ctx));

  if (type === "State" && issues.length === 0) {
    const name = String((props.name as { value: UiValue }).value);
    const initial = (props.initial as { value: UiValue }).value as UiPrimitive;
    ctx.declared.set(name, initial);
    ctx.states.push({ id, name, initial });
  }

  const children = childrenOf(spec.children, type);
  if (issues.length) return { kind: "error", id, label: type, issues, children };
  return { kind: "component", id, type, props, children };
}

function componentIssues(
  type: UiComponentType,
  raw: RawElement,
  props: Record<string, UiProp>,
  ctx: ValidationContext,
): string[] {
  const issues: string[] = [];
  const staticValue = (name: string) => (props[name]?.kind === "static" ? props[name].value : undefined);
  const has = (name: string) => raw.attrs.some((attr) => attr.name === name);

  if (type === "State") {
    const name = staticValue("name");
    if (typeof name === "string" && ctx.declared.has(name)) issues.push(`State "${name}" is already declared`);
    if (props.initial?.kind === "expr") {
      issues.push("initial must be a literal: a number, text, or true/false");
    }
  }
  if (type === "Button") {
    const setting = has("set");
    const prefilling = has("prefill");
    if (!setting && !prefilling) issues.push("Button needs one action: set (with to) or prefill");
    if (setting && prefilling) issues.push("Button takes one action: set or prefill, not both");
    if (setting && !has("to")) issues.push('set needs a to value, like to={0}');
    if (!setting && has("to")) issues.push("to only works with set");
    const hasLabel = has("label") || raw.children.some((child) =>
      child.kind === "expr" || (child.kind === "text" && child.text.trim()));
    if (!hasLabel && (raw.closed || !ctx.streaming)) issues.push("Button needs a label");
  }
  if (type === "Slider" || type === "Toggle" || type === "Select") {
    const bind = staticValue("bind");
    if (typeof bind === "string" && ctx.declared.has(bind)) {
      const initial = ctx.declared.get(bind) as UiPrimitive;
      const expected = type === "Slider" ? "number" : type === "Toggle" ? "boolean" : "string";
      if (primitiveKind(initial) !== expected) {
        issues.push(`${type} needs a ${expected === "string" ? "text" : expected === "boolean" ? "true/false" : "number"} State, but "${bind}" starts as ${primitiveKind(initial)}`);
      }
    }
  }
  return issues;
}

function validateChildren(
  raw: RawNode[],
  policy: ChildPolicy,
  parentType: string,
  parentId: string,
  depth: number,
  ctx: ValidationContext,
): UiNode[] {
  const out: UiNode[] = [];
  let elementIndex = 0;
  let inlineIndex = 0;
  const parentLabel = parentType === "" ? "the block" : `<${parentType}>`;
  for (const child of normalizeText(raw, policy === "inline")) {
    if (child.kind === "pending") {
      if (isUiComponentType(child.name)) {
        out.push({ kind: "pending", id: childId(parentId, String(elementIndex)), type: child.name });
      }
      continue;
    }
    if (child.kind === "element") {
      if (child.dropped) continue;
      const id = childId(parentId, String(elementIndex));
      elementIndex += 1;
      if (policy !== "blocks") {
        const node = validateElement(child, id, depth, ctx);
        const reason = policy === "inline"
          ? `<${child.name}> can't go inside ${parentLabel}; it takes text only`
          : `${parentLabel} doesn't take children`;
        out.push({
          kind: "error",
          id,
          label: child.name,
          issues: node.kind === "error" ? [reason, ...node.issues] : [reason],
          children: node.kind === "component" || node.kind === "error" ? node.children : [],
        });
        continue;
      }
      out.push(validateElement(child, id, depth, ctx));
      continue;
    }
    const id = childId(parentId, `t${inlineIndex}`);
    inlineIndex += 1;
    if (policy === "none") {
      out.push({ kind: "error", id, label: "text", issues: [`${parentLabel} doesn't take children`], children: [] });
      continue;
    }
    if (child.kind === "text") {
      out.push({ kind: "text", id, text: child.text });
      continue;
    }
    const parsed = parseUiExpression(child.source);
    if (!parsed.ok) {
      out.push({ kind: "error", id, label: "expression", issues: [parsed.error], children: [] });
      continue;
    }
    const undeclared = uiExpressionRefs(parsed.expr).filter((ref) => !ctx.declared.has(ref));
    if (undeclared.length) {
      out.push({ kind: "error", id, label: "expression", issues: [`"${undeclared[0]}" isn't a State declared above it`], children: [] });
      continue;
    }
    out.push({ kind: "expr", id, expr: parsed.expr, source: child.source.trim() });
  }
  return out;
}

/**
 * Parse and validate a `coven:ui` body. Streaming mode re-parses the whole
 * prefix: open tags auto-close, a trailing partial tag/attribute/expression
 * is dropped (a known component shows a pending placeholder), and truncation
 * is never reported. Settled mode reports what a cut-off block lost.
 */
export function buildUiBlock(source: string, options: { streaming?: boolean } = {}): UiBlockDocument {
  const streaming = Boolean(options.streaming);
  if (source.length > UI_BLOCK_LIMITS.maxSourceLength) {
    return {
      status: "fallback",
      nodes: [],
      states: [],
      diagnostics: [`This block is too large to render (over ${UI_BLOCK_LIMITS.maxSourceLength.toLocaleString("en-US")} characters).`],
    };
  }
  try {
    const parsed = parseMarkup(source, streaming);
    const ctx: ValidationContext = { declared: new Map(), states: [], streaming };
    const nodes = validateChildren(parsed.roots, ROOT_POLICY, "", "", 0, ctx);
    const diagnostics = [...parsed.diagnostics];
    if (!streaming) {
      if (parsed.truncated) diagnostics.push("This block ended early; its last tag was incomplete.");
      for (const name of parsed.unclosed) diagnostics.push(`<${name}> was not closed.`);
    }
    const hasElements = parsed.elementCount > 0 || nodes.some((node) => node.kind === "pending");
    if (!hasElements) {
      const meaningful = streaming ? nodes.length > 0 : source.trim().length > 0;
      return { status: meaningful ? "fallback" : "empty", nodes: [], states: [], diagnostics: streaming ? [] : diagnostics };
    }
    return { status: "ok", nodes, states: ctx.states, diagnostics };
  } catch {
    return { status: "fallback", nodes: [], states: [], diagnostics: ["This block couldn't be read."] };
  }
}

// ── runtime ────────────────────────────────────────────────────────────────

/** Current state: declared initial values with user changes layered on top, by name. */
export function uiBlockStateValues(
  states: readonly UiStateDeclaration[],
  overrides: Readonly<Record<string, UiPrimitive>>,
): Record<string, UiPrimitive> {
  const out: Record<string, UiPrimitive> = {};
  for (const state of states) {
    out[state.name] = Object.hasOwn(overrides, state.name) ? overrides[state.name] : state.initial;
  }
  return out;
}

/**
 * Resolve a component's props against the current state: defaults first,
 * then static values, then evaluated expressions, each checked against the
 * catalog. A failure is reported for this node only.
 */
export function resolveUiProps(
  node: UiComponentNode,
  state: UiStateValues,
): { ok: true; props: Record<string, UiValue> } | { ok: false; issues: string[] } {
  const spec = UI_BLOCK_CATALOG[node.type];
  const props: Record<string, UiValue> = {};
  const issues: string[] = [];
  for (const [name, propSpec] of Object.entries(spec.props)) {
    if (propSpec.default !== undefined) props[name] = propSpec.default;
  }
  for (const [name, prop] of Object.entries(node.props)) {
    if (prop.kind === "static") {
      props[name] = prop.value;
      continue;
    }
    const result = evaluateUiExpression(prop.expr, state);
    if (!result.ok) {
      issues.push(`${name}: ${result.error}`);
      continue;
    }
    const issue = checkPropValue(node.type, name, spec.props[name], result.value);
    if (issue) issues.push(issue);
    else props[name] = result.value;
  }
  if ((node.type === "Slider") && typeof props.min === "number" && typeof props.max === "number") {
    if (props.min >= props.max) issues.push("min must be below max");
    if (typeof props.step === "number" && props.step <= 0) issues.push("step must be above 0");
  }
  if (node.type === "Progress" && typeof props.max === "number" && props.max <= 0) {
    issues.push("max must be above 0");
  }
  return issues.length ? { ok: false, issues } : { ok: true, props };
}

/** Format a value for display. Numbers follow the format token; text passes through. */
export function formatUiValue(value: UiValue, format?: string, locale?: string): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (typeof value !== "number") return "";
  switch (format) {
    case "usd":
    case "eur":
    case "gbp":
      return new Intl.NumberFormat(locale, { style: "currency", currency: format.toUpperCase() }).format(value);
    case "percent":
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`;
    case "compact":
      return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
}

// ── fences ─────────────────────────────────────────────────────────────────

const UI_FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*coven:ui[ \t]*$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

export type UiTextPiece =
  | { kind: "text"; text: string }
  | { kind: "ui"; source: string; complete: boolean };

type SourceLine = { start: number; contentEnd: number; end: number; content: string };

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const contentEnd = newline === -1 ? text.length : newline;
    const end = newline === -1 ? text.length : newline + 1;
    const withoutReturn = contentEnd > start && text[contentEnd - 1] === "\r" ? contentEnd - 1 : contentEnd;
    lines.push({ start, contentEnd, end, content: text.slice(start, withoutReturn) });
    start = end;
  }
  return lines;
}

function findClose(lines: SourceLine[], from: number, fence: string): number {
  for (let index = from; index < lines.length; index += 1) {
    const match = FENCE_CLOSE_RE.exec(lines[index].content);
    if (match && match[1][0] === fence[0] && match[1].length >= fence.length) return index;
  }
  return -1;
}

/**
 * Split settled prose on top-level ```coven:ui fences. A coven:ui example
 * inside another fence, a list, a quote or an indented code block stays
 * literal text: openers are only honoured at the start of a fenced range,
 * never inside one (`fencedRanges`, the same guard every marker uses). An
 * unterminated final block still renders from the saved text.
 */
export function sliceUiBlocks(text: string): UiTextPiece[] {
  if (!text || !text.includes(UI_BLOCK_FENCE_INFO)) return [{ kind: "text", text }];
  const lines = sourceLines(text);
  const ranges = fencedRanges(text);
  const insideEarlierFence = (offset: number) => ranges.some(([start, end]) => start < offset && offset < end);
  const pieces: UiTextPiece[] = [];
  let cursor = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const open = UI_FENCE_OPEN_RE.exec(line.content);
    if (open && line.end > line.contentEnd && !insideEarlierFence(line.start)) {
      const close = findClose(lines, index + 1, open[2]);
      if (line.start > cursor) pieces.push({ kind: "text", text: text.slice(cursor, line.start) });
      if (close === -1) {
        pieces.push({ kind: "ui", source: text.slice(line.end).replace(/\s+$/, ""), complete: false });
        cursor = text.length;
        break;
      }
      pieces.push({ kind: "ui", source: text.slice(line.end, lines[close].start).replace(/\r?\n$/, ""), complete: true });
      cursor = lines[close].contentEnd;
      index = close + 1;
      continue;
    }
    const ordinary = FENCE_OPEN_RE.exec(line.content);
    if (ordinary && !(ordinary[1][0] === "`" && ordinary[2].includes("`"))) {
      const close = findClose(lines, index + 1, ordinary[1]);
      if (close === -1) break;
      index = close + 1;
      continue;
    }
    index += 1;
  }
  if (pieces.length === 0) return [{ kind: "text", text }];
  if (cursor < text.length) pieces.push({ kind: "text", text: text.slice(cursor) });
  return pieces;
}

/**
 * Read a streaming markdown block (from partitionStreamingMarkdown) that is a
 * coven:ui fence. Returns null for any other block. A closing fence that has
 * only partly arrived is held back so it never flashes as body text.
 */
export function uiFenceBody(source: string): { body: string; closed: boolean } | null {
  const newline = source.indexOf("\n");
  if (newline === -1) return null;
  const open = UI_FENCE_OPEN_RE.exec(source.slice(0, newline).replace(/\r$/, ""));
  if (!open) return null;
  const fence = open[2];
  const rest = source.slice(newline + 1);
  const lines = rest.split("\n");
  let offset = 0;
  for (const line of lines) {
    const match = FENCE_CLOSE_RE.exec(line.replace(/\r$/, ""));
    if (match && match[1][0] === fence[0] && match[1].length >= fence.length) {
      return { body: rest.slice(0, offset).replace(/\r?\n$/, ""), closed: true };
    }
    offset += line.length + 1;
  }
  const lastNewline = rest.lastIndexOf("\n");
  const lastLine = rest.slice(lastNewline + 1).replace(/\r$/, "");
  const partialClose = /^ {0,3}([`~]+)[ \t]*$/.exec(lastLine);
  if (partialClose && partialClose[1][0] === fence[0]) {
    return { body: lastNewline === -1 ? "" : rest.slice(0, lastNewline), closed: false };
  }
  return { body: rest, closed: false };
}

/** True for a half-written opener line (```coven:u) that must not flash as text. */
export function isPartialUiFenceOpener(source: string): boolean {
  if (source.includes("\n")) return false;
  const match = /^ {0,3}(?:`{3,}|~{3,})[ \t]*(\S+)$/.exec(source);
  return Boolean(match && UI_BLOCK_FENCE_INFO.startsWith(match[1]));
}

/**
 * React key for a streaming coven:ui block. Streaming block ids end in the
 * block's current end offset, which grows with every chunk; keying on the
 * start offset alone keeps one mounted renderer (and its State) per block.
 */
export function stableUiBlockKey(streamingBlockId: string): string {
  const dash = streamingBlockId.lastIndexOf("-");
  return `${dash === -1 ? streamingBlockId : streamingBlockId.slice(0, dash)}:coven-ui`;
}

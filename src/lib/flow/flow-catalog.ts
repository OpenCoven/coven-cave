// Flow node catalog — the n8n-style "node library" the Flow editor draws from.
//
// Each entry is a FlowNodeType: the template used both to render the searchable
// add-node panel and to seed a new FlowNode (default params, port layout,
// icon/accent). Mapped into the Coven context — triggers, familiars (agents),
// skills, MCP tools, HTTP, logic/flow control, data, and human gates — rather
// than n8n's 400+ SaaS integrations.

import type { IconName } from "@/lib/icon";
import type { FlowDoc, FlowNode, FlowParamValue, FlowPosition } from "./flow-doc.ts";
import { nextNodeId, uniqueNodeName } from "./flow-doc.ts";

export type FlowNodeCategory = "trigger" | "ai" | "tool" | "logic" | "data" | "human" | "note";

export type FlowParamControl =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "familiar"
  | "skill"
  | "code"
  | "json";

export type FlowParamField = {
  key: string;
  label: string;
  control: FlowParamControl;
  default?: FlowParamValue;
  placeholder?: string;
  help?: string;
  /** For `select`. */
  options?: Array<{ value: string; label: string }>;
};

export type FlowPort = {
  id: string;
  /** Optional badge under the handle (e.g. "true" / "false"). */
  label?: string;
};

export type FlowNodeType = {
  type: string;
  label: string;
  category: FlowNodeCategory;
  /** Section heading in the catalog. */
  group: string;
  icon: IconName;
  /** Icon-tile accent (hex; semantic per category). */
  accent: string;
  description: string;
  /** Triggers have no input handle and a distinct rounded-left card. */
  isTrigger?: boolean;
  inputs: FlowPort[];
  outputs: FlowPort[];
  params: FlowParamField[];
  /** Sticky notes are non-executable canvas annotations. */
  sticky?: boolean;
};

const MAIN_OUT: FlowPort[] = [{ id: "main" }];
const ONE_IN: FlowPort[] = [{ id: "in" }];

/** Accent palette by category — drives the node icon-tile color. */
export const CATEGORY_ACCENT: Record<FlowNodeCategory, string> = {
  trigger: "#d98b3f",
  ai: "#9a8ecd",
  tool: "#6b8fbf",
  logic: "#5aa37a",
  data: "#7c9b70",
  human: "#c08a4a",
  note: "#c9b458",
};

export const STICKY_COLORS: Array<{ key: string; label: string; fill: string }> = [
  { key: "yellow", label: "Yellow", fill: "#3a3413" },
  { key: "violet", label: "Violet", fill: "#2c2746" },
  { key: "green", label: "Green", fill: "#15301f" },
  { key: "blue", label: "Blue", fill: "#152a3a" },
  { key: "rose", label: "Rose", fill: "#3a1722" },
];

export const FLOW_CATALOG: FlowNodeType[] = [
  // ---- Triggers ----------------------------------------------------------
  {
    type: "trigger.manual",
    label: "Manual Trigger",
    category: "trigger",
    group: "Triggers",
    icon: "ph:cursor-click",
    accent: CATEGORY_ACCENT.trigger,
    description: "Runs the flow when you press Execute.",
    isTrigger: true,
    inputs: [],
    outputs: MAIN_OUT,
    params: [],
  },
  {
    type: "trigger.schedule",
    label: "Schedule Trigger",
    category: "trigger",
    group: "Triggers",
    icon: "ph:clock",
    accent: CATEGORY_ACCENT.trigger,
    description: "Fires on an interval or a cron schedule.",
    isTrigger: true,
    inputs: [],
    outputs: MAIN_OUT,
    params: [
      {
        key: "mode",
        label: "Trigger on",
        control: "select",
        default: "interval",
        options: [
          { value: "interval", label: "Interval" },
          { value: "cron", label: "Cron expression" },
        ],
      },
      { key: "everyMinutes", label: "Every N minutes", control: "number", default: 60 },
      { key: "cron", label: "Cron expression", control: "text", placeholder: "0 9 * * 1-5" },
    ],
  },
  {
    type: "trigger.webhook",
    label: "Webhook",
    category: "trigger",
    group: "Triggers",
    icon: "ph:link",
    accent: CATEGORY_ACCENT.trigger,
    description: "Starts the flow when an HTTP request hits its path.",
    isTrigger: true,
    inputs: [],
    outputs: MAIN_OUT,
    params: [
      {
        key: "method",
        label: "Method",
        control: "select",
        default: "POST",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m })),
      },
      { key: "path", label: "Path", control: "text", default: "/hook", placeholder: "/my-webhook" },
    ],
  },
  {
    type: "trigger.chat",
    label: "Chat Message",
    category: "trigger",
    group: "Triggers",
    icon: "ph:chats",
    accent: CATEGORY_ACCENT.trigger,
    description: "Starts when a familiar receives a chat message.",
    isTrigger: true,
    inputs: [],
    outputs: MAIN_OUT,
    params: [{ key: "familiar", label: "Listen as familiar", control: "familiar" }],
  },

  // ---- AI / Familiars ----------------------------------------------------
  {
    type: "familiar",
    label: "Familiar",
    category: "ai",
    group: "AI",
    icon: "ph:sparkle",
    accent: CATEGORY_ACCENT.ai,
    description: "Runs a prompt as one of your familiars (an agent step).",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [
      { key: "familiar", label: "Familiar", control: "familiar" },
      {
        key: "prompt",
        label: "Prompt",
        control: "textarea",
        placeholder: "What should this familiar do with the incoming data?",
      },
    ],
  },
  {
    type: "ai.classify",
    label: "Classifier",
    category: "ai",
    group: "AI",
    icon: "ph:traffic-sign",
    accent: CATEGORY_ACCENT.ai,
    description: "Routes input into named categories using a familiar.",
    inputs: ONE_IN,
    outputs: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    params: [
      { key: "familiar", label: "Familiar", control: "familiar" },
      {
        key: "categories",
        label: "Categories (one per line)",
        control: "textarea",
        placeholder: "bug\nfeature\nquestion",
      },
    ],
  },

  // ---- Skills & Tools ----------------------------------------------------
  {
    type: "skill",
    label: "Skill",
    category: "tool",
    group: "Tools",
    icon: "ph:puzzle-piece",
    accent: CATEGORY_ACCENT.tool,
    description: "Invokes a registered Coven skill.",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [
      { key: "skill", label: "Skill", control: "skill" },
      { key: "input", label: "Input", control: "textarea" },
    ],
  },
  {
    type: "mcp",
    label: "MCP Tool",
    category: "tool",
    group: "Tools",
    icon: "ph:plug",
    accent: CATEGORY_ACCENT.tool,
    description: "Calls a tool exposed by an MCP server.",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [
      { key: "server", label: "MCP server", control: "text", placeholder: "huggingface" },
      { key: "tool", label: "Tool", control: "text" },
      { key: "args", label: "Arguments (JSON)", control: "json", default: "{}" },
    ],
  },
  {
    type: "http",
    label: "HTTP Request",
    category: "tool",
    group: "Tools",
    icon: "ph:globe",
    accent: CATEGORY_ACCENT.tool,
    description: "Makes an outbound HTTP request.",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [
      {
        key: "method",
        label: "Method",
        control: "select",
        default: "GET",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m })),
      },
      { key: "url", label: "URL", control: "text", placeholder: "https://api.example.com/v1" },
      { key: "headers", label: "Headers (JSON)", control: "json", default: "{}" },
      { key: "body", label: "Body (JSON)", control: "json", default: "{}" },
    ],
  },
  {
    type: "code",
    label: "Code",
    category: "tool",
    group: "Tools",
    icon: "ph:code",
    accent: CATEGORY_ACCENT.tool,
    description: "Transforms data with a small expression.",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [
      {
        key: "language",
        label: "Language",
        control: "select",
        default: "javascript",
        options: [
          { value: "javascript", label: "JavaScript" },
          { value: "python", label: "Python" },
        ],
      },
      { key: "code", label: "Code", control: "code", default: "return items;" },
    ],
  },

  // ---- Logic / Flow control ---------------------------------------------
  {
    type: "logic.if",
    label: "IF",
    category: "logic",
    group: "Flow",
    icon: "ph:git-fork",
    accent: CATEGORY_ACCENT.logic,
    description: "Splits the flow into true and false branches.",
    inputs: ONE_IN,
    outputs: [
      { id: "true", label: "true" },
      { id: "false", label: "false" },
    ],
    params: [{ key: "condition", label: "Condition", control: "text", placeholder: "{{ $json.status }} == 'open'" }],
  },
  {
    type: "logic.switch",
    label: "Switch",
    category: "logic",
    group: "Flow",
    icon: "ph:signpost",
    accent: CATEGORY_ACCENT.logic,
    description: "Routes input down one of several branches.",
    inputs: ONE_IN,
    outputs: [
      { id: "0", label: "1" },
      { id: "1", label: "2" },
      { id: "2", label: "3" },
      { id: "fallback", label: "else" },
    ],
    params: [{ key: "rules", label: "Routing rules (one per line)", control: "textarea" }],
  },
  {
    type: "logic.merge",
    label: "Merge",
    category: "logic",
    group: "Flow",
    icon: "ph:arrows-merge",
    accent: CATEGORY_ACCENT.logic,
    description: "Combines two branches back into one.",
    inputs: [
      { id: "in-0", label: "1" },
      { id: "in-1", label: "2" },
    ],
    outputs: MAIN_OUT,
    params: [
      {
        key: "mode",
        label: "Mode",
        control: "select",
        default: "append",
        options: [
          { value: "append", label: "Append" },
          { value: "combine", label: "Combine" },
          { value: "wait", label: "Wait for both" },
        ],
      },
    ],
  },
  {
    type: "logic.filter",
    label: "Filter",
    category: "logic",
    group: "Flow",
    icon: "ph:funnel",
    accent: CATEGORY_ACCENT.logic,
    description: "Drops items that don't match a condition.",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [{ key: "condition", label: "Keep when", control: "text", placeholder: "{{ $json.score }} > 0.5" }],
  },
  {
    type: "logic.loop",
    label: "Loop Over Items",
    category: "logic",
    group: "Flow",
    icon: "ph:repeat",
    accent: CATEGORY_ACCENT.logic,
    description: "Iterates the input in batches.",
    inputs: ONE_IN,
    outputs: [
      { id: "loop", label: "loop" },
      { id: "done", label: "done" },
    ],
    params: [{ key: "batchSize", label: "Batch size", control: "number", default: 1 }],
  },
  {
    type: "logic.wait",
    label: "Wait",
    category: "logic",
    group: "Flow",
    icon: "ph:hourglass",
    accent: CATEGORY_ACCENT.logic,
    description: "Pauses the flow before continuing.",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [
      { key: "seconds", label: "Wait (seconds)", control: "number", default: 30 },
    ],
  },

  // ---- Data --------------------------------------------------------------
  {
    type: "data.set",
    label: "Edit Fields",
    category: "data",
    group: "Data",
    icon: "ph:sliders-horizontal",
    accent: CATEGORY_ACCENT.data,
    description: "Sets or rewrites fields on the data passing through.",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [{ key: "fields", label: "Fields (JSON)", control: "json", default: "{}" }],
  },
  {
    type: "data.output",
    label: "Output",
    category: "data",
    group: "Data",
    icon: "ph:flag-checkered",
    accent: CATEGORY_ACCENT.data,
    description: "Marks the end of a branch and returns the result.",
    inputs: ONE_IN,
    outputs: [],
    params: [{ key: "label", label: "Result label", control: "text", placeholder: "done" }],
  },
  {
    type: "data.execution",
    label: "Execution Data",
    category: "data",
    group: "Data",
    icon: "ph:tag-bold",
    accent: CATEGORY_ACCENT.data,
    description: "Saves a key/value field on each execution so runs can be filtered later.",
    inputs: ONE_IN,
    outputs: MAIN_OUT,
    params: [
      { key: "key", label: "Key", control: "text", placeholder: "customer" },
      { key: "value", label: "Value", control: "text", placeholder: "OpenCoven" },
    ],
  },

  // ---- Human -------------------------------------------------------------
  {
    type: "human.gate",
    label: "Human Approval",
    category: "human",
    group: "Human",
    icon: "ph:hand",
    accent: CATEGORY_ACCENT.human,
    description: "Pauses for a person to approve or reject before continuing.",
    inputs: ONE_IN,
    outputs: [
      { id: "approved", label: "approved" },
      { id: "rejected", label: "rejected" },
    ],
    params: [{ key: "prompt", label: "Ask the approver", control: "textarea" }],
  },

  // ---- Note --------------------------------------------------------------
  {
    type: "sticky",
    label: "Sticky Note",
    category: "note",
    group: "Notes",
    icon: "ph:note",
    accent: CATEGORY_ACCENT.note,
    description: "A free-text annotation pinned to the canvas.",
    inputs: [],
    outputs: [],
    params: [],
    sticky: true,
  },
];

const BY_TYPE = new Map(FLOW_CATALOG.map((node) => [node.type, node]));

export function catalogNode(type: string): FlowNodeType | undefined {
  return BY_TYPE.get(type);
}

/** The order categories appear in the catalog panel. */
export const CATALOG_GROUP_ORDER = ["Triggers", "AI", "Tools", "Flow", "Data", "Human", "Notes"];

export function catalogGroups(): Array<{ group: string; nodes: FlowNodeType[] }> {
  return groupCatalog(FLOW_CATALOG);
}

/** Fuzzy-ish substring search across label/description/group, grouped. */
export function searchCatalog(query: string): Array<{ group: string; nodes: FlowNodeType[] }> {
  const q = query.trim().toLowerCase();
  if (!q) return catalogGroups();
  const matches = FLOW_CATALOG.filter((node) => {
    const haystack = `${node.label} ${node.description} ${node.group} ${node.type}`.toLowerCase();
    return q.split(/\s+/).every((term) => haystack.includes(term));
  });
  return groupCatalog(matches);
}

function groupCatalog(nodes: FlowNodeType[]): Array<{ group: string; nodes: FlowNodeType[] }> {
  const byGroup = new Map<string, FlowNodeType[]>();
  for (const node of nodes) {
    const list = byGroup.get(node.group) ?? [];
    list.push(node);
    byGroup.set(node.group, list);
  }
  return CATALOG_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    nodes: byGroup.get(group) ?? [],
  }));
}

/** Default params for a node type, drawn from each field's `default`. */
export function defaultParams(type: FlowNodeType): Record<string, FlowParamValue> {
  const params: Record<string, FlowParamValue> = {};
  for (const field of type.params) {
    if (field.default !== undefined) params[field.key] = field.default;
  }
  return params;
}

/**
 * Build a fresh FlowNode for `type` at `position`, with a unique id/name and
 * seeded defaults. Sticky notes get their canvas geometry instead of ports.
 */
export function createNode(doc: FlowDoc, type: string, position: FlowPosition): FlowNode | null {
  const def = BY_TYPE.get(type);
  if (!def) return null;
  const node: FlowNode = {
    id: nextNodeId(doc, type),
    type,
    name: uniqueNodeName(doc, def.label),
    position,
    params: defaultParams(def),
  };
  if (def.sticky) {
    node.sticky = { text: "I'm a note", color: STICKY_COLORS[0].key, width: 240, height: 160 };
  }
  return node;
}

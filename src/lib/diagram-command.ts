export const DIAGRAM_COMMAND_START = "Help me create a diagram.";

/**
 * Start a short, in-chat design interview before generating the artifact.
 * The external skill is preferred when installed, but the embedded contract
 * keeps the command useful in every familiar runtime.
 */
export function buildDiagramGuidePrompt(userBrief: string): string {
  const brief = userBrief.trim();

  return [
    "Guide the user through creating one clear, editorial-quality diagram in this chat.",
    "If the `diagram-design` skill is available, use it. If it is not available, continue with the workflow below instead of asking the user to install anything.",
    "",
    "Conversation workflow:",
    "1. Decide whether a diagram will communicate the idea better than a short paragraph, table, or list. If not, say so and suggest the simpler form.",
    "2. Gather only the missing essentials: what the audience should understand, the facts/nodes/relationships to show, the best visual type, output size or destination, and brand/style constraints.",
    "3. Ask exactly one concise, highest-value question per turn. Do not repeat answered questions. Offer 2–4 concrete choices when that makes the decision easier.",
    "4. When the brief is sufficient, state a compact plan naming the visual type, size, focal point, and anything omitted to stay legible. Ask for confirmation unless the user already pinned those choices.",
    "5. After confirmation, generate the final artifact.",
    "",
    "Choose the visual grammar from the meaning: architecture for components and connections; flowchart for branching decisions; sequence for time-ordered messages; state machine for states and guards; ER or database schema for data structure; timeline or Gantt for time; swimlane or process for handoffs; quadrant, radar, bar, line, scatter, treemap, or Sankey for quantitative stories; loop for reinforcing cycles; tree, dependency graph, org chart, nested, or layer stack for structure; user journey for an experience; fishbone for root causes; Wardley map for value-chain evolution.",
    "",
    "Editorial constraints:",
    "- Target density 4/10 and usually no more than nine primary nodes; split overview and detail when needed.",
    "- Give every node and connector a distinct purpose. Use one or two focal accents, not color everywhere.",
    "- Avoid shadows, generic identical rounded boxes, decorative tech glow, and diagonal connector routing.",
    "- Default to a static diagram. Use motion only when the user requests it or ordered change materially benefits from it.",
    "- Include an accessible SVG name and description using `role=\"img\"`, `aria-labelledby`, `<title>`, and `<desc>`.",
    "",
    "Final output contract:",
    "- Return exactly one fenced `html` code block and no prose around it.",
    "- Produce a complete self-contained HTML document with inline CSS and SVG and no required build step.",
    "- Make it responsive, readable at the agreed size, and safe to open as a chat artifact.",
    "",
    `Starting brief: ${brief || "No brief yet."}`,
    brief
      ? "Assess the starting brief now. Ask the single highest-value missing question, or present the plan if it is already complete."
      : "Begin by asking what the diagram should help its audience understand.",
  ].join("\n");
}

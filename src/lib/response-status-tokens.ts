export type ResponseStatusTone = "success" | "warning" | "danger" | "neutral";

const RESPONSE_STATUS_TONES: Record<string, ResponseStatusTone> = {
  READY: "success",
  COMPLETE: "success",
  DONE: "success",
  RUNNING: "warning",
  STREAMING: "warning",
  PENDING: "warning",
  REVIEW: "warning",
  WARNING: "warning",
  BLOCKED: "danger",
  FAILED: "danger",
  ERROR: "danger",
  PAUSED: "neutral",
  CANCELLED: "neutral",
  SKIPPED: "neutral",
};

const RESPONSE_STATUS_PATTERN =
  /(^|[^\w])\[(READY|COMPLETE|DONE|RUNNING|STREAMING|PENDING|REVIEW|WARNING|BLOCKED|FAILED|ERROR|PAUSED|CANCELLED|SKIPPED)\](?![\w])/gi;

export type ResponseStatusSegment =
  | { kind: "text"; text: string }
  | { kind: "status"; text: string; label: string; tone: ResponseStatusTone };

export function responseStatusTone(value: string): ResponseStatusTone | null {
  return RESPONSE_STATUS_TONES[value.trim().toUpperCase()] ?? null;
}

export function splitResponseStatusText(text: string): ResponseStatusSegment[] {
  const segments: ResponseStatusSegment[] = [];
  let offset = 0;
  RESPONSE_STATUS_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(RESPONSE_STATUS_PATTERN)) {
    const index = match.index ?? 0;
    const prefix = match[1];
    const tokenIndex = index + prefix.length;
    if (tokenIndex > offset) {
      segments.push({ kind: "text", text: text.slice(offset, tokenIndex) });
    }
    const label = match[2].toUpperCase();
    segments.push({
      kind: "status",
      text: text.slice(tokenIndex, index + match[0].length),
      label,
      tone: RESPONSE_STATUS_TONES[label],
    });
    offset = index + match[0].length;
  }

  if (offset < text.length) segments.push({ kind: "text", text: text.slice(offset) });
  return segments.length ? segments : [{ kind: "text", text }];
}

/**
 * Adds app-owned response semantics after untrusted Markdown HTML is sanitized.
 * Code, links, keyboard labels, diagrams, and existing badges remain literal.
 */
export function decorateResponseHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest("code, pre, a, kbd, svg, .cave-response-status")
    ) {
      continue;
    }
    if (splitResponseStatusText(node.data).some((segment) => segment.kind === "status")) {
      textNodes.push(node);
    }
  }

  for (const node of textNodes) {
    const fragment = doc.createDocumentFragment();
    for (const segment of splitResponseStatusText(node.data)) {
      if (segment.kind === "text") {
        fragment.append(doc.createTextNode(segment.text));
        continue;
      }
      const badge = doc.createElement("span");
      badge.className = "cave-response-status";
      badge.dataset.tone = segment.tone;
      badge.setAttribute("aria-label", `Status: ${segment.label.toLowerCase()}`);
      badge.textContent = segment.text;
      fragment.append(badge);
    }
    node.replaceWith(fragment);
  }

  const blocks = Array.from(doc.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6"));
  const firstHeadingIndex = blocks.findIndex((element) => /^H[1-6]$/.test(element.tagName));
  if (firstHeadingIndex > 0) {
    const lead = blocks.slice(0, firstHeadingIndex).find((element) => {
      if (element.tagName !== "P") return false;
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll(".cave-response-status").forEach((status) => status.remove());
      return Boolean(copy.textContent?.trim());
    });
    lead?.classList.add("cave-response-lead");
  }

  return doc.body.innerHTML;
}

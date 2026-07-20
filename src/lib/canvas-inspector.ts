export const CANVAS_INSPECTOR_MESSAGE_TYPE = "cave-canvas-inspector" as const;
export const CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE = "canvas-component-selected" as const;

export type CanvasInspectorMessage = {
  type: typeof CANVAS_INSPECTOR_MESSAGE_TYPE;
  enabled: boolean;
};

export type CanvasInspectorTarget = {
  selector: string;
  label: string;
  excerpt: string;
};

export type CanvasComponentSelectedMessage = {
  type: typeof CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE;
  target: CanvasInspectorTarget;
};

export function isCanvasInspectorMessage(value: unknown): value is CanvasInspectorMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<CanvasInspectorMessage>;
  return message.type === CANVAS_INSPECTOR_MESSAGE_TYPE && typeof message.enabled === "boolean";
}

export function isCanvasComponentSelectedMessage(value: unknown): value is CanvasComponentSelectedMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<CanvasComponentSelectedMessage>;
  const target = message.target as Partial<CanvasInspectorTarget> | undefined;
  return (
    message.type === CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE &&
    !!target &&
    typeof target.selector === "string" &&
    typeof target.label === "string" &&
    typeof target.excerpt === "string"
  );
}

const INSPECTOR_SOURCE = `(() => {
  const ENABLE_TYPE = ${JSON.stringify(CANVAS_INSPECTOR_MESSAGE_TYPE)};
  const SELECTED_TYPE = ${JSON.stringify(CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE)};
  const SELECTOR_LIMIT = 500;
  const LABEL_LIMIT = 200;
  const EXCERPT_LIMIT = 1000;
  let enabled = false;
  let highlighted = null;
  let previousOutline = "";
  let previousOutlineOffset = "";

  const clamp = (value, limit) => String(value || "").slice(0, limit);
  const escapeCss = (value) => {
    const text = String(value || "");
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_-]/g, (character) => "\\\\" + character.codePointAt(0).toString(16) + " ");
  };
  const escapeAttribute = (value) => String(value || "").replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');

  const clearHighlight = () => {
    if (!highlighted) return;
    highlighted.style.outline = previousOutline;
    highlighted.style.outlineOffset = previousOutlineOffset;
    highlighted = null;
  };

  const highlight = (element) => {
    clearHighlight();
    highlighted = element;
    previousOutline = element.style.outline;
    previousOutlineOffset = element.style.outlineOffset;
    element.style.outline = "2px solid #8b5cf6";
    element.style.outlineOffset = "2px";
  };

  const uniquelyIdentifies = (selector, element) => {
    if (!selector || selector.length > SELECTOR_LIMIT) return false;
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch {
      return false;
    }
  };

  const selectorFor = (element) => {
    if (element.id) {
      const idSelector = "#" + escapeCss(element.id);
      if (uniquelyIdentifies(idSelector, element)) return idSelector;
    }
    const testId = element.getAttribute("data-testid");
    if (testId) {
      const testIdSelector = '[data-testid="' + escapeAttribute(testId) + '"]';
      if (uniquelyIdentifies(testIdSelector, element)) return testIdSelector;
    }

    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 6) {
      const tag = String(current.tagName || "*").toLowerCase();
      let part = tag;
      const parent = current.parentElement;
      if (parent && parent.children) {
        const siblings = Array.from(parent.children).filter(
          (sibling) => sibling.tagName === current.tagName,
        );
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      if (selector.length > SELECTOR_LIMIT) break;
      if (uniquelyIdentifies(selector, element)) return selector;
      current = parent;
    }
    return null;
  };

  const labelFor = (element) => {
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("alt") ||
      element.textContent ||
      String(element.tagName || "").toLowerCase();
    return clamp(String(label).replace(/\\s+/g, " ").trim(), LABEL_LIMIT);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.type !== ENABLE_TYPE || typeof message.enabled !== "boolean") return;
    enabled = message.enabled;
    if (!enabled) clearHighlight();
  });

  document.addEventListener("click", (event) => {
    if (!enabled) return;
    const element = event.target;
    if (!element || element.nodeType !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const selector = selectorFor(element);
    if (!selector) {
      clearHighlight();
      return;
    }
    highlight(element);
    window.parent.postMessage({
      type: SELECTED_TYPE,
      target: {
        selector,
        label: labelFor(element),
        excerpt: clamp(element.outerHTML, EXCERPT_LIMIT),
      },
    }, "*");
  }, true);
})();`;

/** Inline inspector script safe to embed in an HTML document. */
export function buildCanvasInspectorScript(): string {
  const escaped = INSPECTOR_SOURCE.replace(/<\/script/gi, "<\\/script");
  return `<script>${escaped}</script>`;
}

/** Append the inspector without rewriting any artifact source bytes. */
export function injectCanvasInspector(html: string): string {
  const source = typeof html === "string" ? html : "";
  return `${source}\n${buildCanvasInspectorScript()}`;
}

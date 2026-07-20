export const CANVAS_INSPECTOR_MESSAGE_TYPE = "cave-canvas-inspector" as const;
export const CANVAS_INSPECTOR_READY_MESSAGE_TYPE = "canvas-inspector-ready" as const;
export const CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE = "canvas-inspector-loaded" as const;
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

type CanvasInspectorPort = Pick<MessagePort, "onmessage" | "postMessage" | "start" | "close">;

export function createCanvasInspectorChannel(options: {
  onLoaded: () => void;
  onSelection: (value: unknown) => void;
}) {
  let port: CanvasInspectorPort | null = null;
  let accepted = false;
  let authenticatedLoad = false;
  let completedLoad = false;
  let pendingLoad = false;

  const closePort = () => {
    port?.close();
    port = null;
    authenticatedLoad = false;
  };

  return {
    get loaded() {
      return authenticatedLoad;
    },
    acceptBootstrap(nextPort: CanvasInspectorPort) {
      if (accepted) {
        nextPort.close();
        return false;
      }
      accepted = true;
      port = nextPort;
      nextPort.onmessage = (event) => {
        if (port !== nextPort) return;
        if (
          event.data
          && typeof event.data === "object"
          && (event.data as { type?: unknown }).type === CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE
        ) {
          if (authenticatedLoad) return;
          authenticatedLoad = true;
          if (pendingLoad) {
            pendingLoad = false;
            completedLoad = true;
          }
          options.onLoaded();
          return;
        }
        if (authenticatedLoad) options.onSelection(event.data);
      };
      nextPort.start();
      return true;
    },
    setEnabled(enabled: boolean) {
      if (!authenticatedLoad || !port) return;
      port.postMessage({ type: CANVAS_INSPECTOR_MESSAGE_TYPE, enabled });
    },
    handleFrameLoad(): "authenticated" | "pending" | "unexpected" {
      if (authenticatedLoad && !completedLoad) {
        completedLoad = true;
        return "authenticated";
      }
      if (!completedLoad && !pendingLoad) {
        pendingLoad = true;
        return "pending";
      }
      closePort();
      return "unexpected";
    },
    settleFrameLoad(): "authenticated" | "unexpected" {
      pendingLoad = false;
      if (authenticatedLoad && !completedLoad) {
        completedLoad = true;
        return "authenticated";
      }
      closePort();
      return "unexpected";
    },
    reset() {
      closePort();
      accepted = false;
      completedLoad = false;
      pendingLoad = false;
    },
    dispose() {
      closePort();
      accepted = true;
      completedLoad = true;
      pendingLoad = false;
    },
  };
}

function inspectorSource(generation: string): string {
  return `(() => {
  const READY_TYPE = ${JSON.stringify(CANVAS_INSPECTOR_READY_MESSAGE_TYPE)};
  const LOADED_TYPE = ${JSON.stringify(CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE)};
  const ENABLE_TYPE = ${JSON.stringify(CANVAS_INSPECTOR_MESSAGE_TYPE)};
  const SELECTED_TYPE = ${JSON.stringify(CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE)};
  const GENERATION = ${JSON.stringify(generation)};
  const SELECTOR_LIMIT = 500;
  const LABEL_LIMIT = 200;
  const EXCERPT_LIMIT = 1000;
  const KEYBOARD_CANDIDATE_SELECTOR = [
    "button", "input", "select", "textarea", "summary", "a[href]", "area[href]",
    "iframe", "[contenteditable]", "[tabindex]",
    '[role]:not([role="none"]):not([role="presentation"])',
    "[aria-label]", "[data-testid]",
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "img", "figure", "td", "th",
    "body :not(script):not(style):not(link):not(meta):not(template):not(noscript):not(:has(*))",
  ].join(",");
  let enabled = false;
  let highlighted = null;
  let previousOutline = "";
  let previousOutlineOffset = "";
  const channel = new MessageChannel();
  const port = channel.port1;
  const postPortMessage = port.postMessage.bind(port);
  const restoredTabIndexes = new Map();

  port.onmessage = (portEvent) => {
    const command = portEvent.data;
    if (!command || command.type !== ENABLE_TYPE || typeof command.enabled !== "boolean") return;
    enabled = command.enabled;
    if (enabled) prepareKeyboardCandidates();
    else {
      clearHighlight();
      restoreTabIndexes();
    }
  };
  port.start();
  window.parent.postMessage({ type: READY_TYPE, generation: GENERATION }, "*", [channel.port2]);
  window.addEventListener("load", () => {
    postPortMessage({ type: LOADED_TYPE });
  }, { once: true });

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

  const isVisible = (element) => {
    if (!element || typeof element.getClientRects !== "function" || element.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const isNaturallyFocusable = (element) => {
    const tag = String(element.tagName || "").toLowerCase();
    if (["button", "input", "select", "textarea", "summary"].includes(tag)) return true;
    if ((tag === "a" || tag === "area") && element.hasAttribute("href")) return true;
    if (tag === "iframe" || element.hasAttribute("contenteditable")) return true;
    const tabIndex = element.getAttribute("tabindex");
    return tabIndex !== null && Number(tabIndex) >= 0;
  };

  const isMeaningfulCandidate = (element) => {
    const tag = String(element.tagName || "").toLowerCase();
    if (["script", "style", "link", "meta", "template", "noscript"].includes(tag)) return false;
    if (isNaturallyFocusable(element)) return true;
    const role = element.getAttribute("role");
    if (role && role !== "none" && role !== "presentation") return true;
    if (
      element.hasAttribute("aria-label")
      || element.hasAttribute("data-testid")
      || element.hasAttribute("tabindex")
    ) {
      return true;
    }
    if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "figure", "img", "td", "th"].includes(tag)) {
      return true;
    }
    return element.children.length === 0 && Boolean(String(element.textContent || "").trim());
  };

  const restoreTabIndexes = () => {
    for (const [element, previous] of restoredTabIndexes) {
      if (previous === null) element.removeAttribute("tabindex");
      else element.setAttribute("tabindex", previous);
    }
    restoredTabIndexes.clear();
  };

  const prepareKeyboardCandidates = () => {
    restoreTabIndexes();
    for (const element of document.querySelectorAll(KEYBOARD_CANDIDATE_SELECTOR)) {
      if (!isVisible(element) || !isMeaningfulCandidate(element) || isNaturallyFocusable(element)) continue;
      restoredTabIndexes.set(element, element.getAttribute("tabindex"));
      element.setAttribute("tabindex", "0");
    }
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

  const select = (element) => {
    const selector = selectorFor(element);
    if (!selector) {
      clearHighlight();
      return;
    }
    highlight(element);
    if (!port) return;
    postPortMessage({
      type: SELECTED_TYPE,
      target: {
        selector,
        label: labelFor(element),
        excerpt: clamp(element.outerHTML, EXCERPT_LIMIT),
      },
    });
  };

  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !enabled) return;
    const element = event.target;
    if (!element || element.nodeType !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    select(element);
  }, true);

  document.addEventListener("focusin", (event) => {
    if (!enabled) return;
    const element = event.target;
    if (!element || element.nodeType !== 1 || !isMeaningfulCandidate(element)) return;
    highlight(element);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!event.isTrusted || !enabled || (event.key !== "Enter" && event.key !== " ")) return;
    const element = event.target;
    if (!element || element.nodeType !== 1 || !isMeaningfulCandidate(element)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    select(element);
  }, true);
})();`;
}

/** Inline inspector script safe to embed in an HTML document. */
export function buildCanvasInspectorScript(generation = ""): string {
  const escaped = inspectorSource(generation).replace(/<\/script/gi, "<\\/script");
  return `<script>${escaped}</script>`;
}

/** Insert the inspector before artifact scripts without rewriting artifact bytes. */
export function injectCanvasInspector(html: string, generation = ""): string {
  const source = typeof html === "string" ? html : "";
  const script = buildCanvasInspectorScript(generation);
  const splitAt = findLeadingDoctypeEnd(source);
  if (splitAt === null) return `${script}${source}`;
  return `${source.slice(0, splitAt)}${script}${source.slice(splitAt)}`;
}

function findLeadingDoctypeEnd(source: string): number | null {
  let offset = 0;

  while (offset < source.length) {
    while (offset < source.length && source[offset].trim() === "") offset += 1;
    if (!source.startsWith("<!--", offset)) break;

    const commentEnd = source.indexOf("-->", offset + 4);
    if (commentEnd === -1) return null;
    offset = commentEnd + 3;
  }

  if (source.slice(offset, offset + 9).toLowerCase() !== "<!doctype") return null;
  const doctypeEnd = source.indexOf(">", offset + 9);
  return doctypeEnd === -1 ? null : doctypeEnd + 1;
}

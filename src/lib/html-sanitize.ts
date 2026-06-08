const DANGEROUS_ELEMENTS_SELECTOR = "script, iframe, object, embed, link, style, meta, base";
const URL_ATTRS = new Set(["href", "src", "xlink:href", "formaction", "poster"]);
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;

  // Browsers ignore ASCII whitespace/control chars while resolving URL schemes,
  // so normalize before checking for javascript:/data:/vbscript: payloads.
  const normalized = trimmed.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  const schemeMatch = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(normalized);
  if (!schemeMatch) return true;

  return SAFE_URL_PROTOCOLS.has(`${schemeMatch[1].toLowerCase()}:`);
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const el of Array.from(doc.querySelectorAll(DANGEROUS_ELEMENTS_SELECTOR))) {
    el.remove();
  }

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.name.toLowerCase();
      if (attrName.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }

      if (URL_ATTRS.has(attrName) && !isSafeUrl(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  return doc.body.innerHTML;
}

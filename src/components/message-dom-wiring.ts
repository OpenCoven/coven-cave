import { createContext, useEffect, useRef } from "react";
import { copyText } from "@/lib/clipboard";
import { parseFileRef, type FileRef } from "@/lib/file-ref";
import { toggleCodeBlockCollapse } from "@/lib/code-block-collapse";
import { FOCUSABLE } from "@/lib/use-focus-trap";
import { wireMermaidDiagrams } from "./mermaid-viewer";

export type FileLinkResolver = (ref: FileRef) => boolean;

/** Chat provides a resolver over its transcript; everywhere else (group chat,
 *  quick chat, previews) the default null keeps prose refs as plain text. */
export const FileLinkResolverContext = createContext<FileLinkResolver | null>(null);

/**
 * Click-time code extraction (CHAT-D7-04). The rendered block is the source
 * of truth, so header buttons do not duplicate potentially-large code in DOM
 * attributes. Line-number spans are presentation-only and excluded.
 */
function codeTextFromWrap(btn: HTMLElement): string {
  const codeEl = btn.closest(".cave-code-wrap")?.querySelector("pre code");
  if (!codeEl) return "";
  const lineEls = Array.from(codeEl.querySelectorAll(".cave-line"));
  if (lineEls.length === 0) return codeEl.textContent ?? "";
  return lineEls
    .map((line) => {
      const clone = line.cloneNode(true) as HTMLElement;
      for (const ln of Array.from(clone.querySelectorAll(".cave-ln"))) ln.remove();
      return clone.textContent ?? "";
    })
    .join("\n");
}

function wireCopyButtons(container: HTMLElement) {
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(".cave-copy-btn-mounted"))) {
    if ((btn as HTMLButtonElement & { _wired?: boolean })._wired) continue;
    (btn as HTMLButtonElement & { _wired?: boolean })._wired = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    btn.addEventListener("click", () => {
      void copyText(codeTextFromWrap(btn)).then((ok) => {
        if (!ok) return;
        btn.textContent = "Copied";
        btn.classList.add("cave-copy-btn--confirmed");
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("cave-copy-btn--confirmed");
        }, 2000);
      });
    });
  }
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(".cave-code-collapse-btn"))) {
    if ((btn as HTMLButtonElement & { _wired?: boolean })._wired) continue;
    (btn as HTMLButtonElement & { _wired?: boolean })._wired = true;
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".cave-code-wrap");
      if (wrap) toggleCodeBlockCollapse(wrap, btn);
    });
  }
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(".cave-code-expand-btn"))) {
    if ((btn as HTMLButtonElement & { _wired?: boolean })._wired) continue;
    (btn as HTMLButtonElement & { _wired?: boolean })._wired = true;
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".cave-code-wrap");
      if (!wrap) return;
      const expanded = wrap.classList.toggle("cave-code-wrap--expanded");
      btn.textContent = expanded ? "Show less" : "Show more";
      if (!expanded) wrap.scrollTop = 0;
    });
  }
}

function wireMarkdownLinks(container: HTMLElement, onOpenUrl?: (url: string) => void) {
  if (!onOpenUrl) return;
  for (const link of Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if ((link as HTMLAnchorElement & { _caveLinkWired?: boolean })._caveLinkWired) continue;
    const href = link.href;
    let parsed: URL;
    try { parsed = new URL(href); } catch { continue; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    (link as HTMLAnchorElement & { _caveLinkWired?: boolean })._caveLinkWired = true;
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      onOpenUrl(href);
    });
  }
}

function wireFilePathLinks(container: HTMLElement, resolve: FileLinkResolver | null) {
  for (const code of Array.from(container.querySelectorAll<HTMLElement>("code"))) {
    if (code.closest("pre") || code.closest(".cave-code-wrap")) continue;
    const flagged = code as HTMLElement & { _caveFileLinkCleanup?: () => void };
    const ref = parseFileRef(code.textContent ?? "");
    const want = Boolean(ref && resolve?.(ref));
    if (want === Boolean(flagged._caveFileLinkCleanup)) continue;
    if (!want) {
      flagged._caveFileLinkCleanup?.();
      delete flagged._caveFileLinkCleanup;
      continue;
    }
    const { path, line } = ref!;
    code.classList.add("cave-file-link");
    code.setAttribute("role", "button");
    code.setAttribute("tabindex", "0");
    code.title = `Open ${path}${line ? `:${line}` : ""} in the Code workspace`;
    const open = () => window.dispatchEvent(new CustomEvent("cave:open-project-file", { detail: { path, line } }));
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    };
    code.addEventListener("click", open);
    code.addEventListener("keydown", onKeydown);
    flagged._caveFileLinkCleanup = () => {
      code.removeEventListener("click", open);
      code.removeEventListener("keydown", onKeydown);
      code.classList.remove("cave-file-link");
      code.removeAttribute("role");
      code.removeAttribute("tabindex");
      code.removeAttribute("title");
    };
  }
}

function openTableLightbox(scroll: HTMLElement) {
  const table = scroll.querySelector("table");
  if (!table) return;
  const overlay = document.createElement("div");
  overlay.className = "cave-table-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Expanded table");
  const panel = document.createElement("div");
  panel.className = "cave-table-lightbox__panel";
  const bar = document.createElement("div");
  bar.className = "cave-table-lightbox__bar";
  const title = document.createElement("span");
  title.className = "cave-table-lightbox__title";
  title.textContent = "Table";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "cave-table-lightbox__close focus-ring";
  close.textContent = "Close";
  bar.append(title, close);
  const body = document.createElement("div");
  body.className = "cave-table-lightbox__body cave-md";
  body.appendChild(table.cloneNode(true));
  panel.append(bar, body);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dismiss = () => {
    document.body.style.overflow = prevOverflow;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    returnFocus?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled"));
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl || !overlay.contains(activeEl)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && activeEl === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeEl === last) {
      event.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener("click", (event) => { if (event.target === overlay) dismiss(); });
  close.addEventListener("click", dismiss);
  document.addEventListener("keydown", onKey);
  close.focus();
}

function wireExpandableTables(container: HTMLElement) {
  for (const scroll of Array.from(container.querySelectorAll<HTMLElement>(".cave-table-scroll"))) {
    const flagged = scroll as HTMLElement & { _caveTableWired?: boolean };
    if (flagged._caveTableWired || !scroll.querySelector("table")) continue;
    flagged._caveTableWired = true;
    const wrap = document.createElement("div");
    wrap.className = "cave-table-block";
    scroll.parentNode?.insertBefore(wrap, scroll);
    wrap.appendChild(scroll);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cave-table-expand-btn";
    btn.title = "Expand table";
    btn.setAttribute("aria-label", "Expand table");
    btn.innerHTML = '<span class="cave-table-expand-glyph" aria-hidden="true">⤢</span> Expand';
    btn.addEventListener("click", () => openTableLightbox(scroll));
    wrap.appendChild(btn);
  }
}

/** Wires DOM injected by markdown and Shiki renderers, preserving rerender,
 * streaming, keyboard, and focus behavior across all message surfaces. */
export function useWireCopyButtons(html: string | null, onOpenUrl?: (url: string) => void, fileLinkResolver: FileLinkResolver | null = null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!html || !el) return;
    const wireAll = () => {
      wireCopyButtons(el);
      wireMarkdownLinks(el, onOpenUrl);
      wireMermaidDiagrams(el);
      wireExpandableTables(el);
      wireFilePathLinks(el, fileLinkResolver);
    };
    wireAll();
    const observer = new MutationObserver(() => wireAll());
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [html, onOpenUrl, fileLinkResolver]);
  return containerRef;
}

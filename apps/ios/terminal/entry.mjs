// Browser-side terminal emulator for the native iOS app's WKWebView.
// Uses the SAME xterm.js stack as the desktop terminal (@xterm/xterm +
// addon-fit + addon-web-links), so it's a real VT emulator — colours, cursor
// addressing, alternate-screen TUIs (vim/htop/less) — rather than a stripped
// line-discipline. Bundled to a self-contained HTML by
// scripts/build-ios-terminal.mjs and driven by XtermWebView.swift.
//
// Bridge protocol (postMessage to the `term` handler):
//   JS → Swift:  { type:"input", data } | { type:"resize", cols, rows }
//                { type:"link", href } | { type:"ready" }
//   Swift → JS:  window.caveTerm.write(b64) | .fit() | .clear() | .focus()

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

function post(msg) {
  window.webkit?.messageHandlers?.term?.postMessage(msg);
}

const term = new Terminal({
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.1,
  cursorBlink: true,
  scrollback: 5000,
  allowProposedApi: true,
  macOptionIsMeta: true,
  theme: {
    background: "#16181d",
    foreground: "#e6e6e6",
    cursor: "#e6e6e6",
    selectionBackground: "#3b4252",
    black: "#16181d",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
});

const fit = new FitAddon();
term.loadAddon(fit);
term.loadAddon(
  new WebLinksAddon((_event, uri) => post({ type: "link", href: uri })),
);

term.open(document.getElementById("root"));

// User keystrokes (char-mode — required for TUIs) → Swift → pty-ws.
term.onData((data) => post({ type: "input", data }));

let lastCols = 0;
let lastRows = 0;
function doFit() {
  try {
    fit.fit();
  } catch {
    /* container not laid out yet */
  }
  if (term.cols !== lastCols || term.rows !== lastRows) {
    lastCols = term.cols;
    lastRows = term.rows;
    post({ type: "resize", cols: term.cols, rows: term.rows });
  }
}

// Base64 → bytes: write raw bytes so xterm reassembles split multibyte UTF-8.
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

window.caveTerm = {
  write(b64) {
    term.write(b64ToBytes(b64));
  },
  fit() {
    doFit();
  },
  clear() {
    term.reset();
  },
  focus() {
    term.focus();
  },
};

window.addEventListener("resize", doFit);
// Fit once layout settles, then announce readiness so Swift flushes its queue.
requestAnimationFrame(() => {
  doFit();
  post({ type: "ready" });
});

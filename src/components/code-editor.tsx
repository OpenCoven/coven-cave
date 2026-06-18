"use client";

import { useMemo } from "react";
import CodeMirror, { EditorView, keymap, type Extension } from "@uiw/react-codemirror";
import { loadLanguage, type LanguageName } from "@uiw/codemirror-extensions-langs";

// Editor chrome themed to the app's tokens so it reads as part of the Cave
// rather than a generic dark box. Only the frame is themed here (background,
// gutter, cursor, selection, active line); the default dark syntax palette
// still colors the code. `dark: true` keeps CodeMirror's dark-mode defaults
// for anything not overridden.
const appTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bg-base)",
      color: "var(--text-primary)",
      height: "100%",
      fontSize: "12px",
    },
    ".cm-content": {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      caretColor: "var(--accent-presence)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-base)",
      color: "var(--text-muted)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--foreground) 4%, transparent)" },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in oklch, var(--foreground) 4%, transparent)",
      color: "var(--text-secondary)",
    },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent-presence)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in oklch, var(--accent-presence) 28%, transparent)",
    },
    ".cm-scroller": { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  },
  { dark: true },
);

// File extension → CodeMirror language. Mirrors the extensions the Projects
// file preview already accepts; anything unmapped just edits as plain text.
const EXT_TO_LANG: Record<string, LanguageName> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  sass: "sass",
  html: "html",
  py: "python",
  rs: "rs",
  go: "go",
  rb: "rb",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sql: "sql",
  swift: "swift",
  kt: "kt",
  lua: "lua",
  php: "php",
  xml: "xml",
  svg: "xml",
  nix: "nix",
};

type Props = {
  value: string;
  /** File name (or path) — its extension selects the language grammar. */
  filename: string;
  onChange: (value: string) => void;
  /** Cmd/Ctrl+S inside the editor. */
  onSave: () => void;
  /** Escape inside the editor. */
  onCancel: () => void;
};

/**
 * CodeMirror 6 editor used by the Projects file preview's edit mode — real
 * syntax highlighting, line numbers, and editor affordances in place of the
 * plain textarea. Cmd/Ctrl+S saves and Escape cancels via an editor keymap so
 * the shortcuts work with the editor focused.
 */
export function CodeEditor({ value, filename, onChange, onSave, onCancel }: Props) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  const extensions = useMemo<Extension[]>(() => {
    const list: Extension[] = [
      EditorView.lineWrapping,
      // High-precedence so Mod-s / Escape win over default bindings.
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => { onSave(); return true; } },
        { key: "Escape", run: () => { onCancel(); return true; } },
      ]),
    ];
    const langName = EXT_TO_LANG[ext];
    if (langName) {
      const lang = loadLanguage(langName);
      if (lang) list.push(lang);
    }
    return list;
  }, [ext, onSave, onCancel]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={appTheme}
      height="100%"
      className="cave-code-editor h-full"
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        foldGutter: false,
        autocompletion: false,
      }}
    />
  );
}

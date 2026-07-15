/**
 * Cave CodeMirror theme — the mood-c editor palette shared by every CodeMirror
 * surface: the Projects file editor (code-editor.tsx), the MdEditor MARKDOWN
 * mode, and the Milkdown Crepe code blocks inside MdEditor VISUAL mode.
 *
 * Derived from the app's canonical Shiki theme (src/styles/shiki/mood-c-dark.json)
 * so edit mode matches read-mode code blocks exactly. The code surface stays
 * dark in every app theme (light modes included), so these are fixed inks,
 * not theme tokens.
 */

import { EditorView, type Extension } from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import moodCTheme from "@/styles/shiki/mood-c-dark.json";

type MoodTheme = {
  colors: Record<string, string>;
  tokenColors: { scope: string[]; settings: { foreground?: string; fontStyle?: string } }[];
};
const mood = moodCTheme as MoodTheme;

function moodColor(scope: string, fallback: string): string {
  for (const tc of mood.tokenColors) {
    if (tc.scope.includes(scope) && tc.settings.foreground) return tc.settings.foreground;
  }
  return fallback;
}

export const moodInk = mood.colors["editor.foreground"] ?? "#c9c2dc";
const gutterInk = mood.colors["editorLineNumber.foreground"] ?? "#4a4560";
const gutterActiveInk = mood.colors["editorLineNumber.activeForeground"] ?? "#7a6fa0";

const C = {
  comment: moodColor("comment", "#4a4560"),
  keyword: moodColor("keyword", "#b388ff"),
  func: moodColor("entity.name.function", "#d4a9ff"),
  type: moodColor("entity.name.type", "#c5aaff"),
  param: moodColor("variable.parameter", "#e8d8ff"),
  string: moodColor("string", "#a8c8ff"),
  constant: moodColor("constant.numeric", "#ffb3c6"),
  property: moodColor("support.type.property-name", "#9dd5ff"),
  attribute: moodColor("entity.other.attribute-name", "#b8d8ff"),
  punct: moodColor("punctuation", "#8070a0"),
  operator: moodColor("operator", "#c09ef0"),
  inserted: moodColor("markup.inserted", "#89ddff"),
  deleted: moodColor("markup.deleted", "#ff8a9b"),
  changed: moodColor("markup.changed", "#ffcc80"),
};

// Lezer tag → mood-c scope mapping. Lezer and TextMate slice the token space
// differently, so this is the closest-role match, not a 1:1 translation.
export const moodHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: C.comment, fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], color: C.keyword },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: C.func },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.tagName)], color: C.type },
  { tag: [t.variableName, t.definition(t.variableName)], color: moodInk },
  { tag: [t.local(t.variableName), t.special(t.variableName)], color: C.param },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.docString], color: C.string },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal, t.escape, t.constant(t.variableName), t.standard(t.variableName), t.unit, t.color], color: C.constant },
  { tag: [t.propertyName, t.definition(t.propertyName), t.tagName, t.labelName], color: C.property },
  { tag: [t.attributeName, t.attributeValue], color: C.attribute },
  { tag: [t.punctuation, t.separator, t.bracket, t.derefOperator, t.meta], color: C.punct },
  { tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.updateOperator, t.definitionOperator, t.typeOperator], color: C.operator },
  { tag: t.inserted, color: C.inserted },
  { tag: t.deleted, color: C.deleted },
  { tag: t.changed, color: C.changed },
  { tag: t.heading, color: C.func, fontWeight: "600" },
  { tag: [t.link, t.url], color: C.property, textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: C.deleted },
]);

// Editor frame themed to the app so it reads as part of the Cave rather than
// a generic dark box: the background rides --code-surface (shared with the
// read-mode blocks) and the caret/selection carry the theme accent. Text and
// gutter inks come from the mood-c palette, NOT theme tokens — the code
// surface is dark even in light app themes, where --text-primary is dark ink.
export const caveEditorFrame = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--code-surface)",
      color: moodInk,
      height: "100%",
      fontSize: "12px",
    },
    ".cm-content": {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      caretColor: "var(--accent-presence)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--code-surface)",
      color: gutterInk,
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklch, white 4%, transparent)" },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in oklch, white 4%, transparent)",
      color: gutterActiveInk,
    },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent-presence)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in oklch, var(--accent-presence) 28%, transparent)",
    },
    ".cm-scroller": { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  },
  { dark: true },
);

/** Frame + syntax highlighting in one extension, for consumers that take a
 *  single `theme` slot (e.g. Milkdown Crepe's code-block feature). */
export const caveCodeMirrorTheme: Extension = [caveEditorFrame, syntaxHighlighting(moodHighlight)];

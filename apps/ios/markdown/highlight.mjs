// Loaded locally only when a message contains a non-diagram code block.
import hljs from "highlight.js/lib/core";

import langSwift from "highlight.js/lib/languages/swift";
import langPython from "highlight.js/lib/languages/python";
import langJavascript from "highlight.js/lib/languages/javascript";
import langTypescript from "highlight.js/lib/languages/typescript";
import langRust from "highlight.js/lib/languages/rust";
import langGo from "highlight.js/lib/languages/go";
import langRuby from "highlight.js/lib/languages/ruby";
import langBash from "highlight.js/lib/languages/bash";
import langJson from "highlight.js/lib/languages/json";
import langYaml from "highlight.js/lib/languages/yaml";
import langSql from "highlight.js/lib/languages/sql";
import langXml from "highlight.js/lib/languages/xml";
import langCss from "highlight.js/lib/languages/css";
import langScss from "highlight.js/lib/languages/scss";
import langMarkdown from "highlight.js/lib/languages/markdown";
import langDiff from "highlight.js/lib/languages/diff";
import langDockerfile from "highlight.js/lib/languages/dockerfile";
import langJava from "highlight.js/lib/languages/java";
import langKotlin from "highlight.js/lib/languages/kotlin";
import langC from "highlight.js/lib/languages/c";
import langCpp from "highlight.js/lib/languages/cpp";
import langPhp from "highlight.js/lib/languages/php";
import langLua from "highlight.js/lib/languages/lua";

const REGISTER = {
  swift: langSwift, python: langPython, javascript: langJavascript,
  typescript: langTypescript, rust: langRust, go: langGo, ruby: langRuby,
  bash: langBash, json: langJson, yaml: langYaml, sql: langSql, xml: langXml,
  css: langCss, scss: langScss, markdown: langMarkdown, diff: langDiff,
  dockerfile: langDockerfile, java: langJava, kotlin: langKotlin, c: langC,
  cpp: langCpp, php: langPhp, lua: langLua,
};
for (const [name, def] of Object.entries(REGISTER)) hljs.registerLanguage(name, def);
hljs.configure({ classPrefix: "hljs-" });

// highlight.js already knows common aliases (js, ts, py, sh, yml, html, c++, …);
// a few extras it doesn't infer from our registered set:
const ALIASES = { sh: "bash", shell: "bash", zsh: "bash", html: "xml", "objective-c": "c" };

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

window.caveHighlight = {
  highlight(code, rawLang) {
    let lang = (rawLang ?? "").trim().toLowerCase().split(/\s+/)[0];
    lang = ALIASES[lang] ?? lang;
    let inner = escapeHtml(code);
    let resolved = "";
    if (lang && hljs.getLanguage(lang)) {
      resolved = lang;
      try { inner = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch {}
    }
    return { inner, resolved };
  },
};

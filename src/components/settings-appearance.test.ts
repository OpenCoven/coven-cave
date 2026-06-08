// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settings = await readFile(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);
const themeScript = await readFile(
  new URL("./theme-script.tsx", import.meta.url),
  "utf8",
);

assert.match(
  settings,
  /aria-pressed=\{active\}/,
  "Theme preset cards should expose their selected state to assistive tech",
);

assert.doesNotMatch(
  settings,
  /url\.hostname\.endsWith\("tweakcn\.com"\)/,
  "tweakcn import should not allow attacker-controlled tweakcn.com suffix hosts",
);

assert.match(
  settings,
  /hostname === "tweakcn\.com"[\s\S]*hostname\.endsWith\("\.tweakcn\.com"\)/,
  "tweakcn import should allow only tweakcn.com or real tweakcn.com subdomains",
);

assert.match(
  settings,
  /encodeURIComponent\(themeId\)/,
  "tweakcn /r/themes/{id} imports should URL-encode the theme id",
);

assert.match(
  settings,
  /encodeURIComponent\(themeName\)/,
  "tweakcn editor imports should URL-encode the theme name",
);

assert.match(
  themeScript,
  /html\.style\.setProperty\(cssName, group\[name\]\)/,
  "ThemeScript should apply custom vars via setProperty so existing inline styles are preserved",
);

assert.match(
  themeScript,
  /applyGroup\(cssVars\.theme\)[\s\S]*applyGroup\(cssVars\.dark\)/,
  "ThemeScript should apply both theme-level (fonts/radius) and dark-mode CSS var groups",
);

assert.match(
  themeScript,
  /name\.indexOf\("--"\) === 0 \? name : "--" \+ name/,
  "ThemeScript should accept tweakcn's bare-name keys by prefixing -- when missing",
);

assert.match(
  settings,
  /apply\(cssVars\.theme\)[\s\S]*apply\(cssVars\.dark\)/,
  "applyCustomVars should apply both theme-level and dark-mode CSS var groups, not just a whitelist",
);

assert.match(
  settings,
  /name\.startsWith\("--"\) \? name : `--\$\{name\}`/,
  "applyCustomVars should accept tweakcn's bare-name keys by prefixing -- when missing",
);

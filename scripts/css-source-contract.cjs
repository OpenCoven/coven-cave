const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const rawReadFileSync = fs.readFileSync.bind(fs);

const FACADE_PATHS = new Set([
  "src/app/globals.css",
  "src/styles/cave-chat.css",
  "src/styles/board.css",
  "src/styles/home-composer.css",
  "src/styles/sidebar-minimal.css",
  "src/styles/cave-md.css",
]);

function filenameFor(input) {
  if (input instanceof URL) return fileURLToPath(input);
  return path.resolve(String(input));
}

function isFacade(input) {
  const relative = path.relative(process.cwd(), filenameFor(input)).split(path.sep).join("/");
  return FACADE_PATHS.has(relative);
}

function readRawCssSync(input, options = "utf8") {
  return rawReadFileSync(input, options);
}

function expandCss(filename, seen = new Set()) {
  const resolved = path.resolve(filename);
  if (seen.has(resolved)) throw new Error(`CSS import cycle: ${[...seen, resolved].join(" -> ")}`);
  seen.add(resolved);
  const source = rawReadFileSync(resolved, "utf8");
  const expanded = source.replace(/^@import\s+["']([^"']+)["'];?\s*$/gm, (statement, specifier) => {
    if (!specifier.startsWith(".")) return statement;
    return expandCss(path.resolve(path.dirname(resolved), specifier), new Set(seen));
  });
  return expanded;
}

function readEffectiveCssSync(input, options = "utf8") {
  if (!isFacade(input)) return rawReadFileSync(input, options);
  const filename = filenameFor(input);
  const raw = rawReadFileSync(filename, "utf8");
  const imports = raw.match(/^@import\s+[^;]+;\s*$/gm)?.join("\n") ?? "";
  // Source contracts use this virtual view for selectors, but a few deliberately
  // verify a facade's public imports. Keep those directives as inert metadata.
  const css = `${expandCss(filename)}${imports ? `\n/* facade imports\n${imports}\n*/` : ""}`;
  if (typeof options === "string" || options?.encoding) return css;
  return Buffer.from(css);
}

module.exports = {
  FACADE_PATHS,
  isFacade,
  readRawCssSync,
  readEffectiveCssSync,
};

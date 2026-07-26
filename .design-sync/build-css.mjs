// design-sync CSS pre-build: compile src/app/globals.css (a Tailwind v4
// CSS-first entry — `@import "tailwindcss"` + utility classes in ui/ sources)
// into a static stylesheet the converter can ship. Run from the repo root
// before .ds-sync/package-build.mjs; cfg.cssEntry points at the output.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// pnpm exposes only direct deps at the root; postcss is transitive — resolve
// it through @tailwindcss/postcss's own dependency tree.
const rootRequire = createRequire(resolve(root, "package.json"));
const twPath = rootRequire.resolve("@tailwindcss/postcss");
const tailwindcss = (await import(twPath)).default;
const postcss = (await import(createRequire(twPath).resolve("postcss"))).default;
const from = resolve(root, "src/app/globals.css");
const to = resolve(root, ".design-sync/.cache/globals.compiled.css");

const css = readFileSync(from, "utf8");
const result = await postcss([tailwindcss({ base: root })]).process(css, { from, to });
// Prepend the authored font layer (.design-sync/fonts.css): the app gets its
// --font-* variables from next/font at runtime, which previews/designs don't
// have. Its @import must precede all other rules.
const fonts = readFileSync(resolve(root, ".design-sync/fonts.css"), "utf8");
mkdirSync(dirname(to), { recursive: true });
writeFileSync(to, fonts + "\n" + result.css);
console.error(`✓ compiled ${from} → ${to} (${Math.round(result.css.length / 1024)} KB)`);

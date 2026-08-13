// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const previewPath = path.join(here, "research-markdown-preview.tsx");
const sanitizerPath = path.join(root, "src/lib/html-sanitize.ts");
const shellPath = path.join(root, "src/lib/markdown-preview-shell.ts");

async function browserBundle(source, plugins = []) {
  const result = await build({
    bundle: true,
    format: "iife",
    legalComments: "none",
    minify: true,
    platform: "browser",
    plugins,
    stdin: {
      contents: source,
      loader: "tsx",
      resolveDir: root,
    },
    tsconfig: path.join(root, "tsconfig.json"),
    write: false,
  });
  return result.outputFiles[0].text;
}

const renderPipeline = await browserBundle(`
  import { parse } from "@create-markdown/core";
  import { renderAsync } from "@create-markdown/preview";
  import { sanitizeHtml } from ${JSON.stringify(sanitizerPath)};
  import { unwrapPreviewShell } from ${JSON.stringify(shellPath)};

  window.sanitizeResearchHtml = sanitizeHtml;
  window.renderResearchMarkdown = async (markdown) =>
    unwrapPreviewShell(sanitizeHtml(await renderAsync(parse(markdown), { sanitize: sanitizeHtml })));
`);

const deferredPreviewLoader = {
  name: "deferred-preview-loader",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@\/lib\/markdown-preview$/ }, () => ({
      path: "deferred-preview-loader",
      namespace: "research-preview-test",
    }));
    pluginBuild.onLoad({ filter: /^deferred-preview-loader$/, namespace: "research-preview-test" }, () => ({
      contents: `
        export function loadMarkdownPreview() {
          return Promise.resolve({
            renderAsync(markdown) {
              return new Promise((resolve, reject) => {
                window.researchPreviewTest.requests.push({ markdown, resolve, reject });
              });
            },
          });
        }
      `,
      loader: "js",
    }));
  },
};

const componentHarness = await browserBundle(`
  import { createElement } from "react";
  import { createRoot } from "react-dom/client";
  import { ResearchMarkdownPreview } from ${JSON.stringify(previewPath)};

  const root = createRoot(document.querySelector("#race-preview"));
  window.researchPreviewTest = {
    requests: [],
    render(markdown) {
      root.render(createElement(ResearchMarkdownPreview, { markdown }));
    },
  };
`, [deferredPreviewLoader]);

const executablePath = chromium.executablePath();
if (!existsSync(executablePath)) {
  console.log(`research-markdown-preview.behavior.test.tsx skipped: browser not installed at ${executablePath}`);
} else {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><div id="preview"></div><div id="race-preview"></div></main>');
    await page.addScriptTag({ content: renderPipeline });

    await page.evaluate(async (markdown) => {
      document.querySelector("#preview").innerHTML = await window.renderResearchMarkdown(markdown);
    }, `# Field notes

- first finding
- second finding

\`\`\`ts
const trusted = true;
\`\`\`

[secure](https://example.com/research)
[email](mailto:research@example.com)
[jump](#findings)
[javascript](javascript:alert(1))
[data](data:text/html,unsafe)

<i>ordinary inline markup</i>`);
    await page.evaluate(() => {
      const hostileHtml = `
        <a id="inline-javascript" href="javascript:alert(2)">inline javascript</a>
        <a id="inline-data" href="data:text/html,unsafe">inline data</a>
        <a id="eventful" href="https://example.com" onclick="alert(3)">eventful</a>
        <script id="script">alert(4)</script>
        <iframe id="frame" src="https://evil.example"></iframe>
        <object id="object" data="https://evil.example"></object>
        <embed id="embed" src="https://evil.example">
        <style id="style">body { display: none }</style>
        <link id="link" rel="stylesheet" href="https://evil.example/style.css">`;
      const root = document.querySelector("#preview");
      root.innerHTML += window.sanitizeResearchHtml(hostileHtml);
    });

    const preview = await page.evaluate(() => {
      const root = document.querySelector("#preview");
      const href = (selector) => root.querySelector(selector)?.getAttribute("href");
      return {
        dangerousElements: ["#script", "#frame", "#object", "#embed", "#style", "#link"]
          .map((selector) => root.querySelector(selector))
          .filter(Boolean).length,
        eventAttribute: root.querySelector("#eventful")?.getAttribute("onclick"),
        unsafeMarkdownHrefs: [href('a[href="javascript:alert(1)"]'), href('a[href^="data:"]')],
        inlineJavascript: href("#inline-javascript"),
        inlineData: href("#inline-data"),
        unsafeUrlAttributes: Array.from(root.querySelectorAll("[href], [src], [xlink\\:href]"))
          .flatMap((element) => Array.from(element.attributes))
          .filter((attribute) => /^(?:href|src|xlink:href)$/i.test(attribute.name))
          .map((attribute) => attribute.value)
          .filter((value) => /^(?:javascript|data):/i.test(value)),
        eventAttributes: Array.from(root.querySelectorAll("*"))
          .flatMap((element) => Array.from(element.attributes))
          .map((attribute) => attribute.name)
          .filter((name) => name.toLowerCase().startsWith("on")),
        secure: href('a[href="https://example.com/research"]'),
        email: href('a[href="mailto:research@example.com"]'),
        fragment: href('a[href="#findings"]'),
        heading: root.querySelector("h1")?.textContent,
        listItems: root.querySelectorAll("ul > li").length,
        code: root.querySelector("pre code")?.textContent,
      };
    });

    assert.equal(preview.dangerousElements, 0, "dangerous elements never enter the inserted preview DOM");
    assert.equal(preview.eventAttribute ?? null, null, "event handler attributes never enter the inserted preview DOM");
    assert.deepEqual(
      preview.unsafeMarkdownHrefs.map((href) => href ?? null),
      [null, null],
      "Markdown javascript and data links lose their hrefs",
    );
    assert.equal(preview.inlineJavascript ?? null, null, "raw javascript URLs are removed");
    assert.equal(preview.inlineData ?? null, null, "raw data URLs are removed");
    assert.deepEqual(preview.unsafeUrlAttributes, [], "javascript and data URLs never become DOM URL attributes");
    assert.deepEqual(preview.eventAttributes, [], "event attributes never become DOM attributes");
    assert.equal(preview.secure, "https://example.com/research", "HTTPS links survive");
    assert.equal(preview.email, "mailto:research@example.com", "mailto links survive");
    assert.equal(preview.fragment, "#findings", "fragment links survive");
    assert.equal(preview.heading, "Field notes", "normal headings render");
    assert.equal(preview.listItems, 2, "normal lists render");
    assert.match(preview.code ?? "", /const trusted = true;/, "normal code blocks render");

    await page.addScriptTag({ content: componentHarness });
    await page.evaluate(() => window.researchPreviewTest.render("older Markdown"));
    await page.waitForFunction(() => window.researchPreviewTest.requests.length === 1);
    await page.evaluate(() => window.researchPreviewTest.render("newer Markdown"));
    await page.waitForFunction(() => window.researchPreviewTest.requests.length === 2);

    await page.evaluate(() => {
      window.researchPreviewTest.requests[1].resolve('<div class="cm-preview"><p>newer rendered value</p></div>');
    });
    await page.waitForFunction(() => document.querySelector("#race-preview").textContent === "newer rendered value");

    await page.evaluate(() => {
      window.researchPreviewTest.requests[0].resolve('<div class="cm-preview"><p>older rendered value</p></div>');
    });
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator("#race-preview").textContent(),
      "newer rendered value",
      "an older async render cannot overwrite newer Markdown",
    );
  } finally {
    await browser.close();
  }
}

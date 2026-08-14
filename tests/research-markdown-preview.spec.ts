import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const previewPath = path.join(root, "src/components/role-surfaces/research-markdown-preview.tsx");
const sanitizerPath = path.join(root, "src/lib/html-sanitize.ts");
const shellPath = path.join(root, "src/lib/markdown-preview-shell.ts");

async function browserBundle(source: string, plugins: Parameters<typeof build>[0]["plugins"] = []) {
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
  setup(pluginBuild: Parameters<NonNullable<Parameters<typeof build>[0]["plugins"]>[number]["setup"]>[0]) {
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

type ResearchPreviewWindow = Window & typeof globalThis & {
  sanitizeResearchHtml: (html: string) => string;
  renderResearchMarkdown: (markdown: string) => Promise<string>;
  researchPreviewTest: {
    requests: Array<{ markdown: string; resolve: (html: string) => void }>;
    render: (markdown: string) => void;
  };
};

async function setPreviewHarness(page: Page) {
  await page.setContent('<main><div id="preview"></div><div id="race-preview"></div></main>');
  await page.addScriptTag({ content: renderPipeline });
}

test.describe("research Markdown preview", () => {
  test("sanitizes rendered Markdown before it reaches the browser DOM", async ({ page }) => {
    await setPreviewHarness(page);
    await page.evaluate(async (markdown) => {
      const researchWindow = window as ResearchPreviewWindow;
      document.querySelector("#preview")!.innerHTML = await researchWindow.renderResearchMarkdown(markdown);
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
      const researchWindow = window as ResearchPreviewWindow;
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
      document.querySelector("#preview")!.innerHTML += researchWindow.sanitizeResearchHtml(hostileHtml);
    });

    const preview = await page.evaluate(() => {
      const root = document.querySelector("#preview")!;
      const href = (selector: string) => root.querySelector(selector)?.getAttribute("href");
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

    expect(preview.dangerousElements).toBe(0);
    expect(preview.eventAttribute ?? null).toBeNull();
    expect(preview.unsafeMarkdownHrefs.map((href) => href ?? null)).toEqual([null, null]);
    expect(preview.inlineJavascript ?? null).toBeNull();
    expect(preview.inlineData ?? null).toBeNull();
    expect(preview.unsafeUrlAttributes).toEqual([]);
    expect(preview.eventAttributes).toEqual([]);
    expect(preview.secure).toBe("https://example.com/research");
    expect(preview.email).toBe("mailto:research@example.com");
    expect(preview.fragment).toBe("#findings");
    expect(preview.heading).toBe("Field notes");
    expect(preview.listItems).toBe(2);
    expect(preview.code).toContain("const trusted = true;");
  });

  test("does not allow an older async render to overwrite newer Markdown", async ({ page }) => {
    await setPreviewHarness(page);
    await page.addScriptTag({ content: componentHarness });

    await page.evaluate(() => (window as ResearchPreviewWindow).researchPreviewTest.render("older Markdown"));
    await page.waitForFunction(() => (window as ResearchPreviewWindow).researchPreviewTest.requests.length === 1);
    await page.evaluate(() => (window as ResearchPreviewWindow).researchPreviewTest.render("newer Markdown"));
    await page.waitForFunction(() => (window as ResearchPreviewWindow).researchPreviewTest.requests.length === 2);

    await page.evaluate(() => {
      (window as ResearchPreviewWindow).researchPreviewTest.requests[1].resolve(
        '<div class="cm-preview"><p>newer rendered value</p></div>',
      );
    });
    await expect(page.locator("#race-preview")).toHaveText("newer rendered value");

    await page.evaluate(() => {
      (window as ResearchPreviewWindow).researchPreviewTest.requests[0].resolve(
        '<div class="cm-preview"><p>older rendered value</p></div>',
      );
    });
    await page.waitForTimeout(50);
    await expect(page.locator("#race-preview")).toHaveText("newer rendered value");
  });
});

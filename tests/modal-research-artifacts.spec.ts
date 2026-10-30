import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { researchPackageConfig } from "../scripts/research-package-config.mjs";

// Real installed action/viewer components; all file and publish traffic is synthetic.
let script: string;
let css: string;
let stylesheets: string;
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;
const text = JSON.stringify({ evidence: Array.from({ length: 40 }, (_, index) => ({ index, note: "Preserve the original owner and every unresolved dependency." })) }, null, 2);

test.beforeAll(async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  stylesheets = ((await response.text()).match(/<link\b[^>]*>/g) ?? []).filter(link => /rel="stylesheet"/.test(link)).join("\n");
  expect(stylesheets).not.toBe("");
  const result = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
        import React, {useState} from "react";
        import {createRoot} from "react-dom/client";
        import {LiveRegionProvider} from "./src/components/ui/live-region";
        import {ResearchArtifactActions} from "./node_modules/@opencoven/research/dist/components/role-surfaces/research-artifact-actions.js";
        import "./node_modules/@opencoven/research/dist/styles/globals/surface-research-desk.css";
        const artifact={key:"ledger",kind:"source-ledger",title:"Source ledger",relativePath:"sources.json",iteration:1,state:"working",updatedAt:"2026-10-27T12:00:00Z"};
        const mission={id:"fixture-artifact",title:"Synthetic evidence review",artifacts:[artifact],sources:[],iterations:[]};
        function Fixture(){
          const [busy,setBusy]=useState(false),[published,setPublished]=useState(false);
          const publish=async(key)=>{setBusy(true);try{const result=await fetch("/api/research/missions/fixture-artifact/actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"publish",artifactKey:key})});if(result.ok)setPublished(true);}finally{setBusy(false);}};
          return <LiveRegionProvider><main><ResearchArtifactActions mission={mission} artifact={published?{...artifact,state:"published",knowledgeId:"fixture-knowledge"}:artifact} busy={busy} onPublish={publish}/><output aria-label="Publication status">{published?"Published synthetic artifact":"Working artifact"}</output></main></LiveRegionProvider>;
        }
        createRoot(document.getElementById("root")).render(<Fixture/>);
      `,
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", outfile: "/tmp/coven-modal-artifacts.js",
    alias: researchPackageConfig().aliases,
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

for (const width of [1440, 390]) test.describe(`${width}px Research artifact actions`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) for (const state of ["ready", "empty", "retry"] as const) test(`${theme.theme}/${theme.mode} ${state}`, async ({ page }, testInfo) => {
    const errors: string[] = [], writes: unknown[] = [];
    let readCount = 0;
    let finishPublish: (() => void) | undefined;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "GET" && path === "/api/research/missions/fixture-artifact/files/ledger") {
        readCount++;
        if (state === "retry" && readCount === 1) return route.fulfill({ status: 503, json: { ok: false, error: "Synthetic file unavailable. Retry the read." } });
        return route.fulfill({ json: { ok: true, file: { key: "ledger", kind: "source-ledger", title: "Source ledger", fileName: "sources.json", relativePath: "sources.json", content: state === "empty" ? null : text, workspacePath: "/fixture/mission/sources.json", updatedAt: "2026-10-27T12:00:00Z", sourceLedger: { state: "empty", sources: [] } } } });
      }
      if (route.request().method() === "POST" && path === "/api/research/missions/fixture-artifact/actions") {
        writes.push(route.request().postDataJSON());
        await new Promise<void>(resolve => { finishPublish = resolve; });
        return route.fulfill({ json: { ok: true } });
      }
      return route.abort("blockedbyclient");
    });
    await page.route("**/__research-artifacts", route => route.fulfill({ contentType: "text/html", body: `<html data-theme="${theme.theme}" data-mode="${theme.mode}"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto("/__research-artifacts");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(width === 390);
    await page.addScriptTag({ content: script });
    const view = page.getByRole("button", { name: "View Source ledger", exact: true });
    const publish = page.getByRole("button", { name: "Publish Source ledger to the Grimoire", exact: true });
    await view.click();
    if (state === "retry") {
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Synthetic file unavailable");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(view).toBeFocused();
      await view.click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    }
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toContainText(state === "empty" ? "This file has not been written yet." : "Preserve the original owner");
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeInViewport({ ratio: 1 });
    if (width === 390) {
      const target = (await close.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    await close.focus();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("artifact-viewer.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(view).toBeFocused();
    expect(readCount).toBe(state === "retry" ? 2 : 1);
    await publish.click();
    await expect.poll(() => finishPublish !== undefined).toBe(true);
    try {
      await expect(publish).toBeDisabled();
      await expect(view).toBeDisabled();
      expect(writes).toEqual([{ action: "publish", artifactKey: "ledger" }]);
    } finally { finishPublish?.(); }
    await expect(page.getByLabel("Publication status")).toContainText("Published synthetic artifact");
    await expect(publish).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open Source ledger in the Grimoire", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

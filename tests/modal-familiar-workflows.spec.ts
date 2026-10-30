import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";

// Real creation/enhancement consumers; no provider or daemon writes leave this fixture.
let script: string, css: string, stylesheets: string;
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;

test.beforeAll(async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  stylesheets = ((await response.text()).match(/<link\b[^>]*>/g) ?? []).filter(link => /rel="stylesheet"/.test(link)).join("\n");
  expect(stylesheets).not.toBe("");
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{useState} from "react";
      import {createRoot} from "react-dom/client";
      import {LiveRegionProvider} from "./src/components/ui/live-region";
      import {Button} from "./src/components/ui/button";
      import {FamiliarSummoningCircle} from "./src/components/familiar-summoning-circle";
      import {resolveFamiliar} from "./src/lib/familiar-resolve";
      const familiar=resolveFamiliar({id:"fixture-review",display_name:"Review familiar",role:"Reviewer",description:"Preserve authored decisions",harness:"codex",model:"fixture-original"},{archived:false});
      function Fixture(){
        const [open,setOpen]=useState(false),[result,setResult]=useState("");
        const enhancing=location.pathname.endsWith("enhance");
        return <LiveRegionProvider><Button onClick={()=>setOpen(true)}>Open familiar</Button><output aria-label="Action result">{result}</output><FamiliarSummoningCircle open={open} onClose={()=>setOpen(false)} existingIds={["taken"]} defaultHarness="codex" daemonRunning={false} enhance={enhancing?familiar:null} memoryCount={0} onCreated={id=>setResult("created:"+id)} onEnhanced={id=>setResult("enhanced:"+id)} onStartChat={id=>setResult("chat:"+id)}/></LiveRegionProvider>
      }
      createRoot(document.getElementById("root")).render(<Fixture/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", outfile: "/tmp/coven-modal-familiar.js",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

async function open(page: Page, kind: string, theme: typeof themes[number]) {
  await page.route(`**/__familiar-${kind}`, route => route.fulfill({ contentType: "text/html", body: `<html data-theme="${theme.theme}" data-mode="${theme.mode}"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto(`/__familiar-${kind}`); await page.addScriptTag({ content: script });
  const opener = page.getByRole("button", { name: "Open familiar", exact: true });
  await opener.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  return { opener, dialog };
}

async function checkLayout(page: Page, dialog: Locator, width: number, height: number) {
  await dialog.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); });
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  const close = dialog.getByRole("button", { name: /^Close/ });
  await expect(close).toBeInViewport({ ratio: 1 }); await close.focus();
  for (const key of ["Tab", "Shift+Tab"]) { await page.keyboard.press(key); expect(await dialog.evaluate(e => e.contains(document.activeElement))).toBe(true); }
}

for (const width of [1440, 390]) test.describe(`${width}px Familiar workflows`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) {
    test(`${theme.theme}/${theme.mode} creation preserves drafts and completes after a failed request`, async ({ page }, testInfo) => {
      const writes: unknown[] = [], errors: string[] = [];
      let release: (() => void) | undefined;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/**", async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (path === "/api/harnesses") return route.fulfill({ json: { ok: true, runtimeHost: "Fixture host", harnesses: [{ id: "codex", label: "Codex", chatSupported: true, installed: true, availability: { state: "ready" } }] } });
        if (path.startsWith("/api/runtime-models/")) return route.fulfill({ status: 503, json: { ok: false, error: "Synthetic inventory unavailable" } });
        if (path === "/api/familiars" && request.method() === "POST") {
          writes.push(request.postDataJSON()); const attempt = writes.length;
          await new Promise<void>(resolve => { release = resolve; });
          return route.fulfill({ status: attempt === 1 ? 503 : 200, json: attempt === 1 ? { ok: false, error: "Synthetic summoning unavailable. Try again." } : { ok: true, id: "fixture-keeper" } });
        }
        return route.abort("blockedbyclient");
      });
      try {
        const { opener, dialog } = await open(page, "create", theme);
        const next = dialog.getByRole("button", { name: "Continue", exact: true });
        await expect(next).toBeDisabled();
        await dialog.getByRole("radio", { name: /Local runtime.*Fixture host/ }).click();
        await next.click();
        const name = dialog.getByRole("textbox", { name: "Name", exact: true }), description = dialog.getByRole("textbox", { name: "What it does *", exact: true });
        await expect(name).toBeFocused();
        await name.fill("Taken"); await description.fill("Preserve authored decisions and unresolved dependencies.");
        await expect(dialog).toContainText("is already taken"); await expect(next).toBeDisabled();
        await name.fill("Fixture Keeper"); await dialog.getByRole("textbox", { name: "Role", exact: true }).fill("Reviewer");
        await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
        await page.keyboard.press("Enter"); await expect(name).toHaveValue("Fixture Keeper"); await expect(description).toHaveValue("Preserve authored decisions and unresolved dependencies.");
        await expect(name).toBeFocused();
        await next.click(); await expect(dialog.getByRole("listbox", { name: "Starter sigils" })).toBeVisible();
        await checkLayout(page, dialog, width, height);
        await page.screenshot({ path: testInfo.outputPath("familiar-form.png"), animations: "disabled" });
        await next.click();
        const summon = dialog.getByRole("button", { name: "Summon", exact: true });
        await expect(dialog).toContainText("Fixture Keeper");
        for (const attempt of [1, 2]) {
          await summon.click(); await expect.poll(() => release !== undefined).toBe(true);
          await expect(dialog.getByRole("button", { name: "Close the summoning circle" })).toBeDisabled();
          await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
          await expect(dialog.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
          await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
          release!(); release = undefined;
          if (attempt === 1) {
            await expect(dialog.getByRole("alert")).toHaveText("Synthetic summoning unavailable. Try again.");
            await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
            await page.screenshot({ path: testInfo.outputPath("familiar-summon-error.png"), animations: "disabled" });
            await checkLayout(page, dialog, width, height);
          }
        }
        const start = dialog.getByRole("button", { name: "Begin the first conversation", exact: true });
        await expect(start).toBeFocused();
        await expect(page.getByLabel("Action result")).toHaveText("created:fixture-keeper");
        await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0);
        await expect(page.getByLabel("Action result")).toHaveText("chat:fixture-keeper"); await expect(opener).toBeFocused();
        expect(writes).toHaveLength(2);
        expect(writes[0]).toEqual(writes[1]);
        expect(writes[0]).toMatchObject({ familiar: { id: "fixture-keeper", displayName: "Fixture Keeper", role: "Reviewer", description: "Preserve authored decisions and unresolved dependencies.", harness: "codex", runtime: { kind: "local" } } });
        await page.keyboard.press("Enter"); await expect(next).toBeDisabled(); await expect(dialog.getByRole("radiogroup", { name: "Vessel", exact: true })).toBeVisible();
        expect(errors).toEqual([]);
      } finally { release?.(); }
    });

    test(`${theme.theme}/${theme.mode} enhancement retains a failed model edit and focuses its success action`, async ({ page }, testInfo) => {
      const writes: unknown[] = [], errors: string[] = [];
      let release: (() => void) | undefined;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/**", async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (path === "/api/config" && request.method() === "PATCH") {
          writes.push(request.postDataJSON()); const attempt = writes.length;
          await new Promise<void>(resolve => { release = resolve; });
          return route.fulfill({ status: attempt === 1 ? 503 : 200, json: { ok: attempt !== 1 } });
        }
        return route.abort("blockedbyclient");
      });
      try {
        const { opener, dialog } = await open(page, "enhance", theme);
        const model = dialog.getByRole("textbox", { name: "Model", exact: true }), complete = dialog.getByRole("button", { name: "Complete the rite", exact: true });
        await expect(complete).toBeDisabled(); await model.fill("fixture-updated");
        for (const attempt of [1, 2]) {
          await complete.click(); await expect.poll(() => release !== undefined).toBe(true);
          await expect(dialog.getByRole("button", { name: "Close the enhancement rite" })).toBeDisabled();
          await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
          await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
          release!(); release = undefined;
          if (attempt === 1) {
            await expect(dialog.getByRole("alert")).toHaveText("Model change failed (HTTP 503).");
            await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
            await expect(model).toHaveValue("fixture-updated");
            await page.screenshot({ path: testInfo.outputPath("familiar-enhancement-error.png"), animations: "disabled" });
            await checkLayout(page, dialog, width, height);
          }
        }
        const done = dialog.getByRole("button", { name: "Done", exact: true });
        // The successful form removes the focused submit button. Keyboard
        // users must land on the next action, as they do after creation.
        await expect(done).toBeFocused(); await expect(page.getByLabel("Action result")).toHaveText("enhanced:fixture-review");
        await page.screenshot({ path: testInfo.outputPath("familiar-enhancement-success.png"), animations: "disabled" });
        await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
        expect(writes).toEqual([{ familiars: { "fixture-review": { model: "fixture-updated" } } }, { familiars: { "fixture-review": { model: "fixture-updated" } } }]);
        expect(errors).toEqual([]);
      } finally { release?.(); }
    });
  }
});


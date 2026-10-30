import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { modalCraftPlan, modalMarketplacePlugin } from "./fixtures/modal-marketplace-fixtures";
import type { CraftDraft } from "../src/lib/craft-draft";

// Real consumers and shared Modal; service responses and parent mutations are synthetic.
let script: string, css: string, stylesheets: string;
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;
const plugin = { ...modalMarketplacePlugin, kind: "craft" as const, installed: true, installation: { version: "0.1.0", source: "catalog", installedAt: "2026-10-27T12:00:00Z", runtime: "codex", verifiedAt: "2026-10-27T12:00:00Z", craftVersion: "0.1.0" } };
const draft: CraftDraft = {
  schemaVersion: "opencoven.craft-draft.v1", id: "fixture-draft",
  plugin: { ...modalMarketplacePlugin, kind: "craft", draft: true, draftId: "fixture-draft" },
  extraction: { familiar: "fixture", generatedAt: "2026-10-27T12:00:00Z", roles: [{ id: "reviewer", name: "Reviewer" }], ledger: {
    skills: [{ id: "dependency-review", roles: ["Reviewer"], origins: ["Direct"] }], components: [],
    workflows: [{ id: "review-unresolved-dependencies", roles: ["Reviewer"], origins: ["Direct"] }], prompts: [],
    capabilities: [{ id: "network.http", roles: ["Reviewer"], origins: ["Direct"] }],
  } },
};

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
      import {MarketplaceDetail} from "./src/components/marketplace/marketplace-detail";
      import "./src/styles/globals/surface-marketplace.css";
      function Fixture(){
        const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState("");
        const isDraft=location.pathname.endsWith("draft");
        async function remove(){setBusy(true);try{await fetch("/api/marketplace/crafts/uninstall",{method:"POST"});setResult("removed")}finally{setBusy(false)}}
        return <LiveRegionProvider><Button onClick={()=>setOpen(true)}>Open Craft</Button><output aria-label="Action result">{result}</output>{open&&<MarketplaceDetail plugin={isDraft?${JSON.stringify(draft.plugin)}:${JSON.stringify(plugin)}} busy={busy} onClose={()=>setOpen(false)} onAdd={()=>{}} onRemove={remove} onActionCleared={()=>{}} onDraftDeleted={()=>setResult("deleted")} onAdjustRoles={seed=>setResult(JSON.stringify(seed))}/>}</LiveRegionProvider>
      }
      createRoot(document.getElementById("root")).render(<Fixture/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", outfile: "/tmp/coven-modal-marketplace.js",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

async function open(page: Page, kind: string, theme: typeof themes[number]) {
  await page.route(`**/__marketplace-${kind}`, route => route.fulfill({ contentType: "text/html", body: `<html data-theme="${theme.theme}" data-mode="${theme.mode}"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto(`/__marketplace-${kind}`); await page.addScriptTag({ content: script });
  const opener = page.getByRole("button", { name: "Open Craft", exact: true });
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

for (const width of [1440, 390]) test.describe(`${width}px Marketplace workflows`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) {
    test(`${theme.theme}/${theme.mode} role mutations remain exclusive through refresh and retry`, async ({ page }, testInfo) => {
      const errors: string[] = [], writes: unknown[] = [];
      page.on("pageerror", error => errors.push(error.message));
      let equipped = false, mutations = 0, reads = 0;
      let releaseWrite: (() => void) | undefined, releaseRead: (() => void) | undefined, releaseRemove: (() => void) | undefined;
      await page.route("**/api/**", async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (path === "/api/harnesses") return route.fulfill({ json: { ok: true, harnesses: [{ id: "codex", installed: true }] } });
        if (path === "/api/marketplace/crafts/plan") return route.fulfill({ json: { ok: true, plan: modalCraftPlan } });
        if (path === "/api/roles") {
          if (++reads <= 2) await new Promise<void>(resolve => { releaseRead = resolve; });
          const effective = { skills: [], tools: [{ id: "shell", origin: "direct", originLabel: "Direct" }], mcpServers: [], plugins: [], workflows: [], prompts: [], capabilities: equipped ? [{ id: "network.http", origin: "craft", originLabel: "via Project review", craftId: plugin.id }] : [] };
          return route.fulfill({ json: { ok: true, roles: ["Reviewer", "Writer"].map((name, index) => ({ id: name.toLowerCase(), name, familiar: "fixture", crafts: index === 0 && equipped ? [plugin.id] : [], effective })) } });
        }
        if (path === "/api/roles/crafts" && request.method() === "POST") {
          const body = request.postDataJSON(); writes.push(body); const attempt = ++mutations;
          if (attempt <= 2) await new Promise<void>(resolve => { releaseWrite = resolve; });
          if (attempt === 1) return route.fulfill({ status: 503, json: { ok: false, error: "Synthetic role update unavailable. Try again." } });
          equipped = body.attach;
          return route.fulfill({ json: { ok: true, crafts: equipped ? [plugin.id] : [] } });
        }
        if (path === "/api/marketplace/crafts/uninstall" && request.method() === "POST") {
          await new Promise<void>(resolve => { releaseRemove = resolve; });
          return route.fulfill({ json: { ok: true } });
        }
        return route.abort("blockedbyclient");
      });
      try {
        const { opener, dialog } = await open(page, "craft", theme);
        await expect(dialog.getByText("Loading Roles…")).toBeVisible();
        await expect.poll(() => releaseRead !== undefined).toBe(true); releaseRead!(); releaseRead = undefined;
        const reviewer = dialog.getByRole("checkbox", { name: /on Reviewer$/ }), writer = dialog.getByRole("checkbox", { name: /on Writer$/ });
        const remove = dialog.getByRole("button", { name: "Remove Craft", exact: true }), close = dialog.getByRole("button", { name: "Close Craft details" });
        if (width === 390) {
          await dialog.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); });
          // Check the activation area, not the native checkbox's visual glyph.
          const target = await reviewer.evaluate(input => {
            const bounds = ((input as HTMLInputElement).labels?.[0] ?? input).getBoundingClientRect();
            return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
          });
          expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
          await reviewer.scrollIntoViewIfNeeded();
          const hit = await reviewer.evaluate(input => {
            const bounds = ((input as HTMLInputElement).labels?.[0] ?? input).getBoundingClientRect();
            return { x: bounds.x + 3, y: bounds.y + 3 };
          });
          await page.touchscreen.tap(hit.x, hit.y);
        } else await reviewer.click();
        await expect.poll(() => releaseWrite !== undefined).toBe(true);
        // A second mutation must not overwrite the sole pending-action owner.
        await expect(writer).toBeDisabled(); await expect(remove).toBeDisabled(); await expect(close).toBeDisabled();
        await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
        releaseWrite!(); releaseWrite = undefined;
        await expect(dialog.getByRole("alert")).toHaveText("Synthetic role update unavailable. Try again.");
        await expect(reviewer).not.toBeChecked(); await expect(writer).toBeEnabled();
        await reviewer.click(); await expect.poll(() => releaseWrite !== undefined).toBe(true); releaseWrite!(); releaseWrite = undefined;
        await expect.poll(() => releaseRead !== undefined).toBe(true);
        await expect(dialog.getByText("Loading Roles…")).toBeVisible(); await expect(remove).toBeDisabled(); await expect(close).toBeDisabled();
        await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); releaseRead!(); releaseRead = undefined;
        const detach = dialog.getByRole("checkbox", { name: /from Reviewer$/ }); await expect(detach).toBeChecked();
        await expect(dialog.getByText("via Project review")).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Detach from 1 Role first" })).toBeDisabled();
        await checkLayout(page, dialog, width, height);
        await detach.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("craft-equipped.png"), animations: "disabled" });
        await detach.click(); await expect(reviewer).not.toBeChecked(); await expect(remove).toBeEnabled();
        await remove.click(); await expect.poll(() => releaseRemove !== undefined).toBe(true);
        await expect(reviewer).toBeDisabled(); await expect(writer).toBeDisabled(); await expect(close).toBeDisabled();
        releaseRemove!(); await expect(remove).toBeEnabled(); await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
        expect(writes).toEqual([true, true, false].map(attach => ({ roleId: "reviewer", familiar: "fixture", craftId: "fixture-review", attach })));
        expect(errors).toEqual([]);
      } finally { releaseRead?.(); releaseWrite?.(); releaseRemove?.(); }
    });

    test(`${theme.theme}/${theme.mode} local draft preserves review after deletion failure and closes on retry`, async ({ page }, testInfo) => {
      const errors: string[] = [], writes: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      let attempts = 0, releaseDraft: (() => void) | undefined, releasePlan: (() => void) | undefined, releaseDelete: (() => void) | undefined;
      await page.route("**/api/**", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === "/api/marketplace/crafts/plan") {
          await new Promise<void>(resolve => { releasePlan = resolve; });
          return route.fulfill({ status: 503, json: { ok: false, error: "Synthetic plan unavailable" } });
        }
        if (url.pathname === "/api/marketplace/crafts/drafts") {
          if (request.method() === "GET") {
            await new Promise<void>(resolve => { releaseDraft = resolve; });
            return route.fulfill({ json: { ok: true, drafts: [draft] } });
          }
          if (request.method() === "DELETE") {
            writes.push(url.searchParams.get("id")!); const attempt = ++attempts;
            await new Promise<void>(resolve => { releaseDelete = resolve; });
            return route.fulfill({ status: attempt === 1 ? 503 : 200, json: attempt === 1 ? { ok: false, error: "Synthetic deletion unavailable. Try again." } : { ok: true, deleted: true } });
          }
        }
        return route.abort("blockedbyclient");
      });
      try {
        const { opener, dialog } = await open(page, "draft", theme);
        const adjust = dialog.getByRole("button", { name: "Adjust roles" }), close = dialog.getByRole("button", { name: "Close", exact: true });
        await expect(dialog).toContainText("Checking the draft's install plan"); await expect(adjust).toBeDisabled();
        await expect.poll(() => !!releaseDraft && !!releasePlan).toBe(true); releaseDraft!(); releasePlan!();
        await expect(dialog).toContainText("Plan check unavailable"); await expect(dialog.getByText(/^dependency-review/)).toBeVisible();
        await adjust.click();
        await expect(page.getByLabel("Action result")).toHaveText(JSON.stringify({ draftId: "fixture-draft", familiar: "fixture", roleIds: ["reviewer"], displayName: modalMarketplacePlugin.displayName }));
        await checkLayout(page, dialog, width, height);
        await page.screenshot({ path: testInfo.outputPath("draft-plan-unavailable.png"), animations: "disabled" });
        for (const attempt of [1, 2]) {
          await dialog.getByRole("button", { name: `Delete draft ${plugin.displayName}`, exact: true }).click();
          expect(writes).toHaveLength(attempt - 1);
          await dialog.getByRole("button", { name: /^Really delete draft/ }).click();
          await expect.poll(() => releaseDelete !== undefined).toBe(true);
          await expect(close).toBeDisabled(); await expect(adjust).toBeDisabled(); await expect(dialog.getByRole("button", { name: "Refine in chat" })).toBeDisabled();
          await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); releaseDelete!(); releaseDelete = undefined;
          if (attempt === 1) {
            await expect(dialog.getByRole("alert")).toHaveText("Synthetic deletion unavailable. Try again.");
            await expect(dialog.getByText(/^dependency-review/)).toBeVisible(); await expect(close).toBeEnabled();
          }
        }
        await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused(); await expect(page.getByLabel("Action result")).toHaveText("deleted");
        expect(writes).toEqual(["fixture-draft", "fixture-draft"]); expect(errors).toEqual([]);
      } finally { releaseDraft?.(); releasePlan?.(); releaseDelete?.(); }
    });
  }
});

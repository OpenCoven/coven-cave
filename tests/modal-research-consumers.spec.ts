import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { researchPackageConfig } from "../scripts/research-package-config.mjs";

// Installed, compiled Research components with production host CSS. These
// fixtures qualify presentation and local interactions, not provider execution.
let script: string;
let css: string;
let stylesheets: string;
const cases = ["resource-off", "resource-empty", "resource-preview", "prompt", "studio-editor", "studio-review"] as const;
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;

test.beforeAll(async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  stylesheets = ((await response.text()).match(/<link\b[^>]*>/g) ?? []).filter(link => /rel="stylesheet"/.test(link)).join("\n");
  expect(stylesheets).not.toBe("");
  const result = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
        import React, {useState,useEffect,useContext} from "react";
        import {createPortal} from "react-dom";
        import {Modal} from "./src/components/ui/modal";
        import {FocusTrapPortalLayersContext} from "./src/lib/use-focus-trap";
        import {createRoot} from "react-dom/client";
        import {LiveRegionProvider} from "./src/components/ui/live-region";
        import {ResearchResourceBrowserModal} from "./node_modules/@opencoven/research/dist/components/research-resource-browser-modal.js";
        import {ResearchPromptBuilder} from "./node_modules/@opencoven/research/dist/components/role-surfaces/research-prompt-builder.js";
        import {GenerationViewerModal, MarkdownEditorModal, GenerationReviewModal} from "./node_modules/@opencoven/research/dist/components/role-surfaces/research-studio-modals.js";
        import "./node_modules/@opencoven/research/dist/styles/globals/surface-research-resources.css";
        import "./node_modules/@opencoven/research/dist/styles/globals/surface-research-prompt.css";
        import "./node_modules/@opencoven/research/dist/styles/globals/surface-research-studio.css";
        const title = "Review the evidence and preserve unresolved project dependencies";
        const generation = {version:2,id:"fixture-blog",familiarId:"fixture",kind:"blog",sourceMissionId:"fixture-mission",sourceTitle:title,status:"ready",createdAt:"2026-10-27T12:00:00Z",updatedAt:"2026-10-27T12:00:00Z",content:{kind:"blog",markdown:"# "+title+"\\n\\n"+"## Evidence\\n\\nPreserve the original source and record the remaining uncertainty.\\n\\n".repeat(24)}};
        const review = {...generation,id:"fixture-podcast",kind:"podcast",status:"draft",content:{kind:"podcast",script:Array.from({length:16},(_,i)=>({id:"s"+i,text:"Preserve the original source and record the remaining uncertainty."}))},renderConfig:{provider:"local",voice:"fixture-voice",length:"standard"}};
        function RegisteredControls() {
          const layers=useContext(FocusTrapPortalLayersContext);
          const [node,setNode]=useState(null);
          useEffect(()=>{const el=document.createElement("div");document.body.appendChild(el);const release=layers.register(el);setNode(el);return()=>{release();el.remove();};},[layers]);
          return node?createPortal(<><button>First portal action</button><button>Last portal action</button></>,node):null;
        }
        function Fixture() {
          const name = new URLSearchParams(location.search).get("case");
          const [open,setOpen]=useState(false),[editor,setEditor]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(null),[applied,setApplied]=useState("");
          const close=()=>setOpen(false);
          const render=async()=>{setBusy(true);setError(null);try{const response=await fetch("/api/research/generations/fixture/render",{method:"POST"});if(!response.ok)setError("Synthetic renderer unavailable. Keep this draft and retry later.");}finally{setBusy(false);}};
          return <LiveRegionProvider><main><button onClick={()=>setOpen(true)}>Open fixture</button><output aria-label="Applied prompt">{applied}</output></main>{open && <>
            {name==="focus-portals" && <Modal open onClose={close} title="Portal traversal" containTabFocus><button>Last dialog action</button><RegisteredControls/></Modal>}
            {name.startsWith("resource-") && <ResearchResourceBrowserModal open onClose={close} title={title} url={name==="resource-empty"?null:"https://resource.example.test/preview"} remoteContentRolloutEnabled contextPackConsent={name==="resource-off"?undefined:{allowRemoteContent:true}} />}
            {name==="prompt" && <ResearchPromptBuilder open draft="Which evidence supports this project decision?" onClose={close} onApply={(text)=>{setApplied(text);close();}} />}
            {name==="studio-editor" && <><GenerationViewerModal generation={generation} onClose={close} onOpenEditor={()=>setEditor(true)} active={!editor}/>{editor && <MarkdownEditorModal generation={generation} onClose={()=>setEditor(false)}/>}</>}
            {name==="studio-review" && <GenerationReviewModal generation={review} onRender={render} rendering={busy} error={error} onClose={close}/>}
          </>}</LiveRegionProvider>;
        }
        createRoot(document.getElementById("root")).render(<Fixture/>);
      `,
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", outfile: "/tmp/coven-modal-research.js",
    alias: researchPackageConfig().aliases,
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

async function checkFrame(page: Page, dialog: Locator, width: number, height: number) {
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const focus = await dialog.evaluate(element => ({ contained: element.contains(document.activeElement), active: document.activeElement?.outerHTML.slice(0, 300), documentFocused: document.hasFocus() }));
    expect(focus.contained, `Tab ${i + 1}: ${JSON.stringify(focus)}`).toBe(true);
  }
  const close = dialog.locator(".ui-modal-close");
  await expect(close).toBeInViewport({ ratio: 1 });
  if (width === 390) {
    const target = (await close.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
}

for (const width of [1440, 390]) test.describe(`${width}px installed Research consumers`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) for (const name of cases) test(`${theme.theme}/${theme.mode} ${name}`, async ({ page }, testInfo) => {
    const errors: string[] = [], writes: string[] = [], previews: string[] = [];
    let finishRender: (() => void) | undefined;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      writes.push(route.request().url());
      if (route.request().method() === "POST" && route.request().url().endsWith("/api/research/generations/fixture/render")) {
        await new Promise<void>(resolve => { finishRender = resolve; });
        return route.fulfill({ status: 503, json: { ok: false } });
      }
      return route.fulfill({ status: 409, json: { ok: false, error: "Outside this fixture." } });
    });
    await page.route("https://resource.example.test/**", route => {
      previews.push(route.request().url());
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><h1>Synthetic resource preview</h1><button>First resource action</button><button>Last resource action</button></body></html>" });
    });
    await page.route("**/__research-modal-review?**", route => route.fulfill({ contentType: "text/html", body: `<html data-theme="${theme.theme}" data-mode="${theme.mode}"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto(`/__research-modal-review?case=${name}`);
    expect(await page.evaluate(() => ({ coarse: matchMedia("(pointer: coarse)").matches, touches: navigator.maxTouchPoints }))).toEqual({ coarse: width === 390, touches: width === 390 ? 1 : 0 });
    await page.addScriptTag({ content: script });
    const opener = page.getByRole("button", { name: "Open fixture", exact: true });
    await opener.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    if (name === "resource-preview") await expect(dialog.frameLocator("iframe").getByRole("heading", { name: "Synthetic resource preview" })).toBeVisible();
    await checkFrame(page, dialog, width, height);
    if (name === "resource-off" || name === "resource-empty") {
      await expect(dialog).toContainText(name === "resource-off" ? "Remote content is off" : "No source URL");
      await expect(dialog.locator("iframe")).toHaveCount(0);
      expect(previews).toEqual([]);
    } else if (name === "resource-preview") {
      const frame = dialog.frameLocator("iframe");
      const first = frame.getByRole("button", { name: "First resource action", exact: true });
      const last = frame.getByRole("button", { name: "Last resource action", exact: true });
      await first.click();
      await page.keyboard.press("Tab");
      await expect(last).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.locator(".ui-modal-close")).toBeFocused();
      await last.click();
      await page.keyboard.press("Shift+Tab");
      await expect(first).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.locator(".ui-modal-close")).toBeFocused();
      expect(previews).toEqual(["https://resource.example.test/preview"]);
    } else if (name === "prompt") {
      const question = dialog.locator("textarea").first();
      await question.fill("Which evidence supports keeping the original dependency?");
      const apply = dialog.getByRole("button", { name: "Apply to composer", exact: true });
      await expect(apply).toBeInViewport({ ratio: 1 });
      await apply.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByLabel("Applied prompt")).toContainText("keeping the original dependency");
      await expect(opener).toBeFocused();
    } else if (name === "studio-editor") {
      const edit = dialog.getByRole("button", { name: /Open in Markdown editor/ });
      await edit.click();
      await expect(page.locator('[role="dialog"][inert]')).toHaveCount(1);
      dialog = page.locator('[role="dialog"][aria-modal="true"]');
      await expect(dialog).toHaveCount(1);
      await checkFrame(page, dialog, width, height);
      const draft = dialog.getByRole("textbox", { name: "Draft markdown", exact: true });
      await draft.fill("# Retained draft\n\nKeep unresolved dependencies.");
      await dialog.getByRole("button", { name: "Rich preview", exact: true }).click();
      await expect(dialog.getByRole("heading", { name: "Retained draft", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Markdown", exact: true }).click();
      await expect(draft).toHaveValue("# Retained draft\n\nKeep unresolved dependencies.");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(edit).toBeFocused();
      dialog = page.getByRole("dialog");
    } else if (name === "studio-review") {
      const render = dialog.getByRole("button", { name: "Render media", exact: true });
      await expect(render).toBeInViewport({ ratio: 1 });
      await render.click();
      await expect.poll(() => finishRender !== undefined).toBe(true);
      try {
        await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
      } finally { finishRender?.(); }
      await expect(dialog).toContainText("Synthetic renderer unavailable");
      await expect(render).toBeEnabled();
    }
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
    if (name !== "prompt") {
      await dialog.locator(".ui-modal-close").click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
    expect(writes).toHaveLength(name === "studio-review" ? 1 : 0);
    expect(errors).toEqual([]);
  });
});


test("registered portal controls preserve native reverse Tab traversal", async ({ page }) => {
  await page.route("**/__research-modal-review?**", route => route.fulfill({ contentType: "text/html", body: `<html data-theme="coven" data-mode="dark"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto("/__research-modal-review?case=focus-portals");
  await page.addScriptTag({ content: script });
  const opener = page.getByRole("button", { name: "Open fixture", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Portal traversal", exact: true });
  const lastDialog = dialog.getByRole("button", { name: "Last dialog action", exact: true });
  const firstPortal = page.getByRole("button", { name: "First portal action", exact: true });
  const lastPortal = page.getByRole("button", { name: "Last portal action", exact: true });
  await expect(firstPortal).toBeVisible();
  await lastDialog.click();
  await page.keyboard.press("Tab");
  await expect(firstPortal).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastDialog).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(lastPortal).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(".ui-modal-close")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastPortal).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

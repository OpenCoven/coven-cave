import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { researchPackageConfig } from "../scripts/research-package-config.mjs";

// Exercise the installed Desk entry point and discovery dialog; all service traffic is synthetic.
let script: string;
let css: string;
let stylesheets: string;
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;


test.beforeAll(async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  stylesheets = ((await response.text()).match(/<link\b[^>]*>/g) ?? []).filter(link => /rel="stylesheet"/.test(link)).join("\n");
  expect(stylesheets).not.toBe("");
  const result = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
        import React,{useState} from "react";
        import {createRoot} from "react-dom/client";
        import {LiveRegionProvider} from "./src/components/ui/live-region";
        import {ResearchTabDesk} from "./node_modules/@opencoven/research/dist/components/role-surfaces/research-tab-desk.js";
        import {ResearchTopicCard} from "./node_modules/@opencoven/research/dist/components/role-surfaces/research-topic-card.js";
        import "./node_modules/@opencoven/research/dist/styles/globals/surface-research-desk.css";
        const research={missions:[],selected:null,selectedId:null,loading:false,error:null,select:()=>{},load:async()=>{}};
        const context={activeFamiliar:{id:"fixture-research",display_name:"Research fixture"},openSession:()=>{}};
        function Fixture(){const [destination,setDestination]=useState("");return <LiveRegionProvider><ResearchTabDesk research={research} context={context} onNavigate={(tab,draft)=>setDestination(tab+":"+draft.mode)}/><output aria-label="Selected destination">{destination}</output></LiveRegionProvider>}
        function ActionsFixture(){const [action,setAction]=useState("");return <><ResearchTopicCard proposal={${JSON.stringify(proposal)}} onDismiss={id=>setAction("dismiss:"+id)} onEditQuestion={id=>setAction("edit:"+id)} onUse={value=>setAction("use:"+value.id)}/><output aria-label="Topic action">{action}</output></>}
        createRoot(document.getElementById("root")).render(location.pathname.endsWith("__research-topic-actions")?<ActionsFixture/>:<Fixture/>);
      `,
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", outfile: "/tmp/coven-modal-discovery.js",
    // Match Next's browser util fallback; do not substitute a test-only validator.
    alias: { ...researchPackageConfig().aliases, "node:util": "next/dist/compiled/util" },
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".svg": "dataurl" },
    inject: ["tests/fixtures/next-browser-process.mjs"],
    define: { global: "globalThis", __dirname: '"/"', "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES": '"1"', "process.env.NEXT_PUBLIC_CAVE_RESEARCH_CONTEXT_PACKS": '"1"', "process.env.NEXT_PUBLIC_CAVE_RESEARCH_TOPIC_DISCOVERY": '"1"' },
  });
  script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

const timestamp = "2026-10-27T12:00:00Z", digest = "0".repeat(64);
const pack = { schema: "opencoven.context-pack/v1", id: "ctx_fixture", digest, createdAt: timestamp, createdBy: { client: "coven-cave" }, purpose: "topic-discovery", subject: { familiarId: "fixture-research" }, consent: { selectionMode: "explicit", allowRemoteQueries: false, allowRemoteContent: false, artifactContentSync: false, retention: "run-only" }, resources: [{ id: "resource_fixture", kind: "artifact", uri: "fixture://evidence", digest, localBlobDigest: digest, selector: { type: "whole-resource" }, trust: "user-authored", sensitivity: "public", capturedAt: timestamp, mediaType: "text/plain" }], policy: { treatResourceTextAsData: true, toolAuthority: "none", allowedPurposes: ["topic-discovery"] }, transforms: { secretScanVersion: "fixture" } };
const job = { schema: "opencoven.topic-discovery-job/v1", id: "topicjob_fixture", contextPackId: pack.id, contextPackDigest: digest, familiarId: "fixture-research", status: "completed", requestedAt: timestamp, startedAt: timestamp, finishedAt: timestamp, proposalIds: ["proposal_fixture"] };
const proposal = { schema: "opencoven.topic-proposal/v1", id: "proposal_fixture", discoveryJobId: job.id, contextPackId: pack.id, title: "Preserve the original evidence across project handoffs", question: "Which unresolved dependencies need an explicit owner before the next handoff?", whyNow: "A synthetic review has unresolved dependencies and needs an explicit next action.", evidence: [{ resourceId: "resource_fixture", selector: { type: "whole-resource" }, excerpt: "Preserve the original owner and unresolved dependencies.", excerptDigest: digest }], counterevidence: [], scores: { groundability: 2, decisionValue: 2, unresolvedness: 2, recurrence: 2, novelty: 2, timeliness: 2, familiarFit: 2, feasibility: 2, humanResonance: 2, riskPenalty: 0, visibleTotal: 2 }, suggested: { mode: "brief", deliverable: "Evidence review", sourceTarget: 3, wallClockMinutes: 10 }, uncertainty: "Synthetic fixture only", relatedMissionIds: [], createdAt: timestamp };
const draft = { version: 1, proposalId: proposal.id, contextPackId: pack.id, contextPackDigest: digest, title: proposal.title, question: proposal.question, mode: "brief", deliverable: "Evidence review", sourceTarget: 3, wallClockMinutes: 10, relatedMissionIds: [] };

for (const width of [1440, 390]) test.describe(`${width}px Desk topic discovery`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) test(`${theme.theme}/${theme.mode} empty, retry and use a topic`, async ({ page }, testInfo) => {
    const errors: string[] = [], writes: Array<{ path: string, body: unknown }> = [];
    let available = false, created = false, createCount = 0, acceptCount = 0;
    let finishCreate: (() => void) | undefined, finishAccept: (() => void) | undefined;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === "GET") {
        if (url.pathname === "/api/research/context-packs") return route.fulfill({ json: { packs: available ? [pack] : [] } });
        if (url.pathname === "/api/research/topic-jobs") return route.fulfill({ json: { jobs: created ? [job] : [] } });
        if (url.pathname === "/api/research/topic-proposals" && url.searchParams.get("jobId") === job.id) return route.fulfill({ json: { proposals: [proposal] } });
        return route.abort("blockedbyclient");
      }
      writes.push({ path: url.pathname, body: request.postData() ? request.postDataJSON() : null });
      if (request.method() === "POST" && url.pathname === "/api/research/topic-jobs") {
        if (++createCount === 1) return route.fulfill({ status: 503, json: { error: "Synthetic discovery unavailable. Try again." } });
        await new Promise<void>(resolve => { finishCreate = resolve; }); created = true;
        return route.fulfill({ json: { job, proposals: [proposal] } });
      }
      if (request.method() === "POST" && url.pathname === "/api/research/topic-proposals/proposal_fixture/accept") {
        if (++acceptCount === 1) return route.fulfill({ status: 503, json: { error: "Synthetic topic unavailable. Try again." } });
        await new Promise<void>(resolve => { finishAccept = resolve; });
        return route.fulfill({ json: { draft } });
      }
      return route.abort("blockedbyclient");
    });
    await page.route("**/__research-discovery", route => route.fulfill({ contentType: "text/html", body: `<html data-theme="${theme.theme}" data-mode="${theme.mode}"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto("/__research-discovery"); await page.addScriptTag({ content: script });
    expect(errors).toEqual([]);
    const opener = page.getByRole("button", { name: "Discover topics", exact: true });
    const dialog = page.getByRole("dialog", { name: "Discover topics", exact: true });
    const run = dialog.getByRole("button", { name: "Run discovery", exact: true });
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    try {
      await expect(opener).toBeVisible(); await opener.focus(); await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Discover topics", exact: true })).toHaveCount(1);
      await expect(run).toBeDisabled();
      await expect(dialog).toContainText("No sealed packs"); await expect(dialog).toContainText("No topics yet");
      await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
      available = true; await page.keyboard.press("Enter");
      await expect(run).toBeEnabled(); await run.click();
      await expect(dialog.getByRole("alert")).toHaveText("Synthetic discovery unavailable. Try again.");
      await run.click(); await expect.poll(() => finishCreate !== undefined).toBe(true); await expect(run).toBeDisabled();
      finishCreate!(); await expect(dialog.getByRole("heading", { name: proposal.title, exact: true })).toBeVisible();
      // A score must read as one label/value row, including on phones. The
      // previously unstyled definition list separated every value onto a new line.
      const scoreRows = dialog.locator(".research-topic-card__score");
      await expect(scoreRows).toHaveCount(10);
      for (const row of await scoreRows.all()) {
        const labelBounds = (await row.locator("dt").boundingBox())!;
        const valueBounds = (await row.locator("dd").boundingBox())!;
        expect(Math.abs(labelBounds.y + labelBounds.height / 2 - valueBounds.y - valueBounds.height / 2)).toBeLessThanOrEqual(1);
        expect(valueBounds.x).toBeGreaterThanOrEqual(labelBounds.x + labelBounds.width);
      }
      // Desk supplies only acceptance; do not offer optional actions that have
      // no callback and therefore cannot do anything for the person clicking.
      await expect(dialog.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Edit question", exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Why this?", exact: true }).click();
      await expect(dialog).toContainText("Preserve the original owner and unresolved dependencies.");
      const use = dialog.getByRole("button", { name: "Use this topic", exact: true });
      await use.click(); await expect(dialog.getByRole("alert")).toHaveText("Synthetic topic unavailable. Try again.");
      await close.focus(); for (const key of ["Tab", "Shift+Tab"]) { await page.keyboard.press(key); expect(await dialog.evaluate(e => e.contains(document.activeElement))).toBe(true); }
      await dialog.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); });
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await expect(close).toBeInViewport({ ratio: 1 });
      if (width === 390) {
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        const target = (await close.boundingBox())!;
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        for (const control of [use, dialog.getByRole("button", { name: "Why this?", exact: true })]) {
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
      }
      await page.screenshot({ path: testInfo.outputPath("topic-discovery-error.png"), animations: "disabled" });
      await use.scrollIntoViewIfNeeded(); await expect(use).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath("topic-discovery-actions.png"), animations: "disabled" });
      await use.click(); await expect.poll(() => finishAccept !== undefined).toBe(true);
      await expect(dialog.getByRole("button", { name: "Opening…", exact: true })).toBeDisabled(); finishAccept!();
      await expect(dialog).toHaveCount(0); await expect(page.getByLabel("Selected destination")).toHaveText("prompt:brief"); await expect(opener).toBeFocused();
      expect(writes).toEqual([{ path: "/api/research/topic-jobs", body: { version: 1, contextPackId: "ctx_fixture", familiarId: "fixture-research" } }, { path: "/api/research/topic-jobs", body: { version: 1, contextPackId: "ctx_fixture", familiarId: "fixture-research" } }, { path: "/api/research/topic-proposals/proposal_fixture/accept", body: null }, { path: "/api/research/topic-proposals/proposal_fixture/accept", body: null }]);
      expect(errors).toEqual([]);
    } finally { finishCreate?.(); finishAccept?.(); }
  });
});

test("topic cards retain optional actions when their caller supplies handlers", async ({ page }) => {
  await page.route("**/__research-topic-actions", route => route.fulfill({ contentType: "text/html", body: `<html data-theme="coven" data-mode="dark"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto("/__research-topic-actions"); await page.addScriptTag({ content: script });
  for (const [label, action] of [["Dismiss", "dismiss"], ["Edit question", "edit"], ["Use this topic", "use"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByLabel("Topic action")).toHaveText(`${action}:${proposal.id}`);
  }
});

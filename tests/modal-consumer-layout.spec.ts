import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { modalMarketplaceResponse } from "./fixtures/modal-marketplace-fixtures";
import { modalTaskResponse, taskReviewTitle } from "./fixtures/modal-task-data";
import { modalStudioResponse, studioAvatar, studioNoteText } from "./fixtures/modal-studio-data";
import { modalWikiResponse } from "./fixtures/modal-wiki-data";
import { modalShellResponse, shellSessions } from "./fixtures/modal-shell-data";

// Actual feature components and production CSS, with synthetic props and API
// responses. This proves component layout, not app navigation or native behavior.
let script: string;
let componentCss: string;
let stylesheetLinks: string;
const consumers = ["feedback", "automation", "reminder", "subscriptions", "quick-open", "broadcast", "template", "shortcuts", "new-card", "canvas-import", "connect-host", "project-settings", "project-setup", "session-trace", "flow-executions", "memory-reader", "report-pr", "report-sessions", "report-reminder", "report-share", "report-chapters", "markdown-ready", "markdown-loading", "markdown-error", "acting-empty", "acting-ready", "follow-up", "code-session", "code-shortcuts", "prompt-snippets", "proposal", "send-later", "avatar", "confirm", "market-detail", "craft-detail", "craft-create", "knowledge-detail", "knowledge-seed", "market-config", "skill-explore", "report-chapters-populated", "code-inspector", "chart-step", "slot-picker", "x-recovery", "mobile-handoff-off", "attachment-markdown", "attachment-text", "attachment-unavailable", "artifact-fullscreen", "summoning-new", "summoning-enhance", "familiar-mcp", "familiar-skill", "board-approval", "calendar-detail", "navigator-stats", "x-publish-confirm", "analytics-signals", "analytics-runtime", "analytics-trust", "analytics-contract", "analytics-board", "analytics-action", "scoped-long"];
consumers.push("studio-note", "studio-look", "studio-test", "familiar-memory", "queue-issue", "auth-vault", "auth-vault-add");
consumers.push("wiki-source", "markdown-table", "markdown-diagram", "markdown-chat-table", "markdown-chat-diagram");
consumers.push("chat-threads", "run-skills", "migration-review", "rail-files", "rail-changes", "rail-files-fullscreen", "rail-changes-fullscreen");
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }];

test.beforeAll(async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  stylesheetLinks = ((await response.text()).match(/<link\b[^>]*>/g) ?? []).filter(link => /rel="stylesheet"/.test(link)).join("\n");
  expect(stylesheetLinks).not.toBe("");
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { modalAnalyticsFixtures } from "./tests/fixtures/modal-analytics-consumers";
      import { modalStudioFixtures } from "./tests/fixtures/modal-studio-consumers";
      import { modalMarkdownFixtures } from "./tests/fixtures/modal-markdown-consumers";
      import { modalShellFixtures } from "./tests/fixtures/modal-shell-consumers";
      import { modalTaskFixtures } from "./tests/fixtures/modal-task-consumers";
      import { modalFamiliarFixtures } from "./tests/fixtures/modal-familiar-consumers";
      import { createRoot } from "react-dom/client";
      import { LiveRegionProvider } from "./src/components/ui/live-region";
      import { AutoModeFeedbackModal } from "./src/components/auto-mode-feedback-modal";
      import { AutomationCreateDialog } from "./src/components/automation-create-dialog";
      import { NewReminderModal } from "./src/components/new-reminder-modal";
      import { GithubSubscriptionsModal } from "./src/components/github-subscriptions-modal";
      import { BrowserQuickOpen } from "./src/components/browser-quick-open";
      import { ChatBroadcastComposer } from "./src/components/chat-broadcast-composer";
      import { SaveTemplateModal } from "./src/components/save-template-modal";
      import { ShortcutsSheet } from "./src/components/shortcuts-sheet";
      import { NewCardModal } from "./src/components/new-card-modal";
      import { CanvasGitHubImportModal } from "./src/components/canvas-github-import-modal";
      import { ConnectHostDialog } from "./src/components/composer-host-chip";
      import { ProjectSettingsModal } from "./src/components/project-settings-modal";
      import { ProjectSetupModal } from "./src/components/project-setup-modal";
      import { SessionTraceOverlay } from "./src/components/session-trace-overlay";
      import { FlowExecutionsDialog } from "./src/components/flow-executions-dialog";
      import { MemoryReaderModal } from "./src/components/familiars-memory-files";
      import { DailyReportPrModal } from "./src/components/daily-report-pr-modal";
      import { DayModals } from "./src/components/daily-report-modals";
      import { buildDayModel } from "./src/lib/daily-report-day";
      import { breakdownForDay } from "./src/lib/daily-report";
      import { ChatMarkdownReader } from "./src/components/chat-markdown-reader";
      import { ActingFamiliarGate } from "./src/components/acting-familiar-gate";
      import { FollowUpTaskReview } from "./src/components/chat-follow-up-task-review";
      import { CodeNewSession } from "./src/components/code-new-session";
      import { CodeShortcutsDialog } from "./src/components/code-shortcuts-dialog";
      import { defaultCodeKeymap } from "./src/lib/code-shortcuts";
      import { PromptSnippetsModal } from "./src/components/prompt-snippets-modal";
      import { ProposalSubmission } from "./src/components/proposal-submission";
      import { ChatSendLater } from "./src/components/chat-send-later";
      import { AvatarLightbox } from "./src/components/ui/avatar-lightbox";
      import { ConfirmProvider, useConfirm } from "./src/components/ui/confirm-dialog";
      import { modalMarketplaceFixtures } from "./tests/fixtures/modal-marketplace-consumers";
      import { modalReaderFixtures } from "./tests/fixtures/modal-reader-consumers";
      import { modalRoleFixtures } from "./tests/fixtures/modal-role-consumers";
      import "./src/styles/chat-canvas.css";
      import "./src/styles/globals/surface-code-room.css";
      const noop = () => {};
      const project = {id:"fixture-project",name:"Extended project planning and review",root:"/fixture/project",createdAt:"2026-10-24T00:00:00.000Z",updatedAt:"2026-10-24T00:00:00.000Z"};
      const date = new Date("2026-10-24T12:00:00");
      const reportItems = Array.from({length:20}, (_,i) => ({id:"response-"+i,kind:"response-needed",title:"Review the extended project plan and record unresolved dependencies " + (i+1),status:"pending",recurrence:{type:"none"},createdAt:date.toISOString(),updatedAt:date.toISOString(),sessionId:"fixture-"+i}));
      reportItems.push({id:"reminder",kind:"reminder",title:"Review the extended project plan and record unresolved dependencies",status:"pending",recurrence:{type:"none"},createdAt:date.toISOString(),updatedAt:date.toISOString(),fireAt:"2026-10-25T09:00:00",sessionId:"fixture"});
      const reportModel = buildDayModel({stats:{reminders:0,responses:20,familiars:0,sessions:20,prsMerged:0},payload:null,breakdown:breakdownForDay(reportItems,date),recent:[],day:date,now:date,items:reportItems});
      const readerDocument = {title:"Extended project planning and review",eyebrow:"Project document",noun:"document",subject:"Document",fallbackFilename:"review",markdown:"# Review notes\\n\\n"+"## Dependencies\\n\\nReview each dependency, preserve authored decisions, and record the next action.\\n\\n".repeat(30)};
      function ConfirmationFixture() {
        const confirm = useConfirm();
        return <button onClick={() => void confirm({title:"Remove this project?",body:"This removes the project from the registry and revokes access. The folder on disk stays available.",confirmLabel:"Remove project",danger:true})}>Open confirmation</button>;
      }
      function Fixture() {
        const [open, setOpen] = useState(false);
        const close = () => setOpen(false);
        const name = new URL(location.href).searchParams.get("case");
        const dialogs = {
          ...modalAnalyticsFixtures(),
          ...modalStudioFixtures(close),
          ...modalMarkdownFixtures(),
          ...modalShellFixtures(close),
          ...modalTaskFixtures(close),
          ...modalFamiliarFixtures(close),
          ...modalMarketplaceFixtures(close),
          ...modalReaderFixtures(close),
          ...modalRoleFixtures(close),
          feedback: <AutoModeFeedbackModal open onClose={close} familiarId="fixture" mission="Review the extended project plan and report unresolved dependencies" outcome="failed" />,
          automation: <AutomationCreateDialog resolvedFamiliars={[]} onClose={close} onCreate={noop} />,
          reminder: <NewReminderModal open onClose={close} familiars={[]} defaultTitle="Review the extended project plan and report unresolved dependencies" defaultWhenText="tomorrow at 9am" onCreate={noop} />,
          subscriptions: <GithubSubscriptionsModal hasPat onConnectPat={noop} onClose={close} />,
          "quick-open": <BrowserQuickOpen tabs={Array.from({length: 24}, (_, i) => ({id:String(i),title:"Project documentation and review notes " + (i+1),url:"https://example.test/review/"+i}))} activeId="0" onSelect={noop} onClose={close} />,
          broadcast: <ChatBroadcastComposer count={24} targets={Array.from({length:24},(_,i)=>"fixture-"+i)} onClose={close} onSent={noop} />,
          template: <SaveTemplateModal open onClose={close} initialBody={"Review each dependency and explain the next action.\\n".repeat(40)} />,
          shortcuts: <ShortcutsSheet open onClose={close} />,
          "new-card": <NewCardModal open onClose={close} familiars={[]} sessions={[]} defaultTitle="Review the project plan" onCreate={noop} />,
          "canvas-import": <CanvasGitHubImportModal open onClose={close} onImported={noop} />,
          "connect-host": <ConnectHostDialog onClose={close} onConnected={noop} />,
          "project-settings": <ProjectSettingsModal project={project} onClose={close} onSaveRepoUrl={async () => false} onRename={async () => false} onDelete={async () => false} />,
          "project-setup": <ProjectSetupModal root={project.root} familiar={{id:"fixture",name:"Review familiar"}} createProject={async () => project} onClose={close} onCreated={noop} />,
          "session-trace": <SessionTraceOverlay target={{id:"fixture",title:"Extended project planning and review"}} onClose={close} />,
          "flow-executions": <FlowExecutionsDialog open onClose={close} onOpenSession={noop} />,
          "memory-reader": <MemoryReaderModal path="/fixture/review.md" title="Extended project planning and review" onClose={close} />,
          "report-pr": <DailyReportPrModal target={{repo:"OpenCoven/coven-cave",number:6200,title:"Consolidate modal layouts and preserve every feature workflow",time:"09:30"}} onClose={close} />,
          "report-sessions": <DayModals modal="sessions" model={reportModel} dateLabel="October 24, 2026" onClose={close} />,
          "report-reminder": <DayModals modal="reminder" model={reportModel} dateLabel="October 24, 2026" onClose={close} />,
          "report-share": <DayModals modal="share" model={reportModel} dateLabel="October 24, 2026" onClose={close} />,
          "report-chapters": <DayModals modal="chapters" model={reportModel} dateLabel="October 24, 2026" onClose={close} />,
          "markdown-ready": <ChatMarkdownReader {...readerDocument} onClose={close} />,
          "markdown-loading": <ChatMarkdownReader {...readerDocument} markdown={null} loading onClose={close} />,
          "markdown-error": <ChatMarkdownReader {...readerDocument} markdown={null} error="Could not load the project document. Retry when the desktop is reachable." errorActions={<button onClick={noop}>Retry</button>} onClose={close} />,
          "acting-empty": <ActingFamiliarGate open actionLabel="Create task" eligibleFamiliars={[]} projectName={project.name} onChoose={noop} onClose={close} />,
          "acting-ready": <ActingFamiliarGate open actionLabel="Create task" eligibleFamiliars={Array.from({length:12},(_,i)=>({id:"fixture-"+i,display_name:"Review familiar " + (i+1),glyph:{kind:"icon",name:"ph:sparkle-fill"}}))} projectName={project.name} onChoose={noop} onClose={close} />,
          "follow-up": <FollowUpTaskReview open sessionId="fixture" context={{turns:[{id:"turn",role:"user",text:"Review the extended project plan and record unresolved dependencies"}],familiarId:"fixture",projectId:project.id}} suggestion={{kind:"task",prompt:"Review the extended project plan and record unresolved dependencies"}} onCreated={noop} onClose={close} />,
          "code-session": <CodeNewSession open initialPrompt={"Review the project and record unresolved dependencies.\\n".repeat(20)} onClose={close} onCreated={noop} />,
          "code-shortcuts": <CodeShortcutsDialog open keymap={defaultCodeKeymap()} onChange={noop} onClose={close} />,
          "prompt-snippets": <PromptSnippetsModal open prompts={Array.from({length:12},(_,i)=>({id:"fixture-"+i,name:"Review project dependencies " + (i+1),description:"Review each dependency and record the next action.",body:"Review each dependency.",source:"builtin",tags:["review"]}))} onPick={noop} onClose={close} />,
          proposal: <ProposalSubmission available={() => true} onRefresh={noop} />,
          "send-later": <ChatSendLater sessionId="fixture" captureMessage={() => ({familiarId:"fixture",sessionId:"fixture",prompt:"Review the extended project plan and record unresolved dependencies"})} onScheduled={noop} />,
          avatar: <AvatarLightbox triggerClassName="h-12 w-12 items-center justify-center" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ctext x='12' y='32'%3EF%3C/text%3E%3C/svg%3E" label="Review familiar"><span>F</span></AvatarLightbox>,
          confirm: <ConfirmationFixture />,
        };
        return <LiveRegionProvider><ConfirmProvider><main><button onClick={() => setOpen(true)}>Open fixture</button></main>{open ? dialogs[name] : null}</ConfirmProvider></LiveRegionProvider>;
      }
      createRoot(document.getElementById("root")).render(<Fixture />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", outfile: "/tmp/coven-modal-consumer.js",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS": '"0"', "process.env.NEXT_PUBLIC_CAVE_ROOMS": '"all"', "process.env.__NEXT_ROUTER_BASEPATH": '""', "process.env.__NEXT_LINK_NO_TOUCH_START": "false", "process.env.__NEXT_I18N_SUPPORT": "false", "process.env.__NEXT_MANUAL_TRAILING_SLASH": "false", "process.env.__NEXT_TRAILING_SLASH": "false", "process.env.__NEXT_MANUAL_CLIENT_BASE_PATH": "false" },
  });
  script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  componentCss = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

for (const width of [1440, 390]) {
  test.describe(`${width}px feature dialogs`, () => {
    const height = width === 390 ? 844 : 1000;
    // Playwright's built-in blocker reads navigator.serviceWorker in opaque
    // sandboxed frames and throws. Block registration with a guarded equivalent.
    test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "allow" });
    for (const theme of themes) {
      for (const consumer of consumers) {
      const behavior = consumer === "code-inspector" && width === 1440 ? "desktop inspector keeps background accessible and contains content" : "controls stay inside the shared frame";
      test(`${theme.theme}/${theme.mode} ${consumer}: ${behavior}`, async ({ page }, testInfo) => {
        const expandedTable = ["markdown-table", "markdown-chat-table"].includes(consumer);
        const expandedDiagram = ["markdown-diagram", "markdown-chat-diagram"].includes(consumer);
        let inlineTableScroll: number | null = null;
        if (consumer === "studio-look") await page.addInitScript(avatar => {
          // This fresh browser context contains only the synthetic image. The
          // real image store hydrates it through its existing migration path.
          localStorage.setItem("cave:familiar-images:v1", JSON.stringify({ "fixture-review": { dataUrl: avatar, mime: "image/svg+xml", updatedAt: "2026-10-24T09:00:00.000Z" } }));
        }, studioAvatar);
        await page.addInitScript(() => {
          try {
            if (navigator.serviceWorker) navigator.serviceWorker.register = async () => { throw new Error("Service workers are disabled in this fixture."); };
          } catch { /* Opaque sandbox frames cannot access service workers. */ }
        });
        const errors: string[] = [];
        const xActions: string[] = [];
        const generationRequests: unknown[] = [];
        const fileWrites: string[] = [];
        const stylesheetErrors: string[] = [];
        page.on("response", response => {
          if (response.request().resourceType() === "stylesheet" && !response.ok()) stylesheetErrors.push(`${response.status()} ${response.url()}`);
        });
        page.on("pageerror", error => {
          errors.push(error.message);
          testInfo.annotations.push({ type: "pageerror", description: error.stack ?? error.message });
        });
        await page.route("**/api/**", route => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/api/project-file" && route.request().method() !== "GET") fileWrites.push(route.request().method());
          if (consumer === "studio-test" && path === "/api/chat/generate/enhance" && route.request().method() === "POST") {
            generationRequests.push(route.request().postDataJSON());
            return route.fulfill({ contentType: "text/event-stream", body: 'data: {"kind":"assistant_chunk","text":"Synthetic reply for layout review only."}\n\ndata: {"kind":"done"}\n\n' });
          }
          if (consumer === "x-publish-confirm" && path === "/api/x/publish") {
            if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, publications: [] } });
            const body = route.request().postDataJSON();
            xActions.push(body.action);
            if (body.action === "draft") return route.fulfill({ json: { ok: true, publication: { id: "fixture-draft", text: body.text, status: "draft", createdAt: "2026-10-24T12:00:00.000Z", updatedAt: "2026-10-24T12:00:00.000Z" }, confirmationToken: "fixture-only-not-a-live-credential", account: { username: "fixture_review" } } });
            return route.fulfill({ status: 409, json: { ok: false, error: "Fixture never publishes." } });
          }
          if (route.request().method() !== "GET") return route.fulfill({ status: 409, json: { ok: false, error: "Fixture does not save changes." } });
          if (["chat-threads", "run-skills", "migration-review", "rail-files", "rail-changes", "rail-files-fullscreen", "rail-changes-fullscreen"].includes(consumer)) {
            const shellResponse = modalShellResponse(new URL(route.request().url()));
            if (shellResponse) return route.fulfill({ json: shellResponse });
          }
          if (consumer === "wiki-source") {
            const wikiResponse = modalWikiResponse(path);
            if (wikiResponse) return route.fulfill({ json: wikiResponse });
          }
          if (["studio-note", "studio-look", "studio-test", "familiar-memory", "queue-issue", "auth-vault", "auth-vault-add"].includes(consumer)) {
            const studioResponse = modalStudioResponse(new URL(route.request().url()));
            if (studioResponse) return route.fulfill({ json: studioResponse });
          }
          if (["board-approval", "navigator-stats"].includes(consumer)) {
            const taskResponse = modalTaskResponse(path);
            if (taskResponse) return route.fulfill({ json: taskResponse });
          }
          const marketplaceResponse = modalMarketplaceResponse(path);
          if (marketplaceResponse) return route.fulfill({ json: marketplaceResponse });
          if (path === "/api/skills/files") return route.fulfill({ json: new URL(route.request().url()).searchParams.has("file") ? { ok: true, text: "# Project review\n\n" + "Preserve authored decisions and record unresolved dependencies.\n\n".repeat(32) } : { ok: true, entries: [{ name: "SKILL.md", kind: "file", size: 4096 }, { name: "references", kind: "dir", children: ["notes.md"] }] } });
          if (path === "/api/github/subscriptions") return route.fulfill({ json: { ok: true, prefs: { enabled: true, events: { prOpened: true, ciCompleted: true }, repos: ["OpenCoven/coven-cave", "OpenCoven/research"] } } });
          if (path === "/api/memory/file") return route.fulfill({ json: { ok: true, text: "# Review notes\n\n" + "## Dependencies\n\nReview the project plan, preserve authored decisions, and record the next action.\n\n".repeat(20) } });
          if (path.endsWith("/events")) return route.fulfill({ json: { ok: true, events: [] } });
          if (path === "/api/flows/runs") return route.fulfill({ json: { ok: true, runs: [] } });
          if (path === "/api/chat/scheduled") return route.fulfill({ json: { ok: true, items: [] } });
          if (path === "/api/github/item") return route.fulfill({ json: { ok: true, title: "Consolidate modal layouts and preserve every feature workflow", number: 6200, state: "closed", isPull: true, merged: true, draft: false, body: "Review the shared modal migration and its behavior evidence.", author: null, assignees: [], labels: [], updatedAt: "2026-10-24T00:00:00.000Z", htmlUrl: "https://github.com/OpenCoven/coven-cave/pull/6200", comments: 0, pull: null } });
          return route.fulfill({ json: { ok: true, skills: [], projects: [], familiars: [], sessions: [] } });
        });
        await page.route("https://www.google.com/**", route => route.abort());
        await page.route("**/__modal-component-review?**", route => route.fulfill({
          contentType: "text/html",
          body: `<html data-theme="${theme.theme}" data-mode="${theme.mode}"><head>${stylesheetLinks}<style>${componentCss}</style></head><body><div id="root"></div></body></html>`,
        }));
          await page.goto(`/__modal-component-review?case=${consumer}`);
          expect(stylesheetErrors, "Production stylesheets load successfully").toEqual([]);
          expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--touch-target").trim()), "Canonical foundation tokens are loaded").toBe("44px");
          await page.addScriptTag({ content: script });
          expect(errors, `${consumer}: mounting the fixture`).toEqual([]);
          let opener = page.getByRole("button", { name: "Open fixture", exact: true });
          await opener.click();
          if (consumer === "migration-review" || consumer.startsWith("rail-")) {
            const label = consumer === "migration-review" ? "Review files" : consumer.startsWith("rail-files") ? "Open files rail" : "Open changes rail";
            opener = page.getByRole("button", { name: label, exact: true });
            await opener.click();
            if (consumer === "rail-files-fullscreen") {
              await page.getByRole("treeitem", { name: "review-1.md", exact: true }).click();
              await page.getByRole("dialog").getByRole("button", { name: "Edit", exact: true }).click();
              await page.locator(".cm-content[contenteditable='true']").fill("# Synthetic rail draft retained across fullscreen changes.");
              await expect(page.getByRole("dialog").getByRole("button", { name: "Save", exact: true })).toBeEnabled();
            }
            if (consumer.endsWith("-fullscreen")) await page.getByRole("button", { name: "Expand code rail fullscreen", exact: true }).click();
          }
          if (consumer === "run-skills") {
            opener = page.getByRole("button", { name: /^Open details for skill Project review 1:/ });
            await opener.click();
          }
          if (consumer === "wiki-source") {
            opener = page.locator("button[data-citation]");
            await opener.click();
          }
          if (["studio-note", "studio-look", "studio-test", "auth-vault", "auth-vault-add"].includes(consumer)) {
            const label = { "studio-note": "Add note", "studio-look": "Enlarge avatar", "studio-test": "Test run", "auth-vault": "Open familiar Vault", "auth-vault-add": "Open familiar Vault" }[consumer];
            opener = page.getByRole("button", { name: label, exact: true });
            await opener.click();
            if (consumer === "auth-vault-add") await page.getByRole("dialog").getByRole("button", { name: "Add environment variable", exact: true }).click();
          }
          if (consumer.startsWith("analytics-")) {
            if (consumer === "analytics-signals") opener = page.locator(".fa-foot__btn").filter({ hasText: "Thread signals" });
            if (consumer === "analytics-runtime") opener = page.locator(".fa-foot__btn").filter({ hasText: "Runtime performance" });
            if (consumer === "analytics-trust") opener = page.getByTitle("How this score is computed", { exact: true });
            if (consumer === "analytics-contract") opener = page.getByRole("button", { name: "Expand the contract panel", exact: true });
            if (consumer === "analytics-board") opener = page.getByTitle("Open the full request board", { exact: true });
            if (consumer === "analytics-action") opener = page.locator(".fa-heal-track .fa-heal-card__open").first();
            await opener.click();
            if (["analytics-signals", "analytics-runtime"].includes(consumer)) await page.getByRole("button", { name: "Open full view", exact: true }).click();
          }
          if (consumer === "calendar-detail") {
            if (width === 1440) await page.getByRole("tab", { name: "Agenda", exact: true }).click();
            opener = page.getByRole("button", { name: new RegExp(taskReviewTitle) });
            await opener.click();
          }
          if (consumer === "navigator-stats") {
            await page.locator(".cr-brief__lead").click();
            await page.getByRole("button", { name: "Open project stats", exact: true }).click();
            opener = page.getByRole("button", { name: "Show all project stats", exact: true });
            await opener.click();
          }
          if (consumer === "x-publish-confirm") {
            await page.getByPlaceholder("What this familiar should post…").fill("Synthetic layout review: preserve authored decisions and unresolved dependencies.");
            opener = page.getByRole("button", { name: "Review this wording", exact: true });
            await opener.click();
            await expect(page.getByRole("dialog").getByRole("button", { name: "Publish to X", exact: true })).toBeEnabled();
            expect(xActions).toEqual(["draft"]);
          }
          if (consumer.startsWith("attachment-")) {
            const filename = { "attachment-markdown": "review.md", "attachment-text": "review.txt", "attachment-unavailable": "review.bin" }[consumer];
            opener = page.getByTitle(`View ${filename}`, { exact: true });
            await opener.click();
          }
          if (consumer === "artifact-fullscreen") {
            await page.getByRole("button", { name: "Refine the artifact…", exact: true }).click();
            await page.getByRole("textbox", { name: "Describe the optimization you want", exact: true }).fill("Preserve this synthetic draft across fullscreen transitions.");
            opener = page.getByRole("button", { name: "Expand artifact fullscreen", exact: true });
            await opener.click();
            await expect(page.getByRole("textbox", { name: "Describe the optimization you want", exact: true })).toHaveValue("Preserve this synthetic draft across fullscreen transitions.");
          }
          const nestedTrigger = expandedTable ? "Expand table" : expandedDiagram ? "Expand diagram" : { proposal: "Send an edit", "send-later": "Send later and scheduled replies", avatar: "Enlarge Review familiar avatar", confirm: "Open confirmation", "x-recovery": "Open X settings", "familiar-mcp": "Connect custom server", "familiar-skill": "Open skill Project review" }[consumer];
          if (nestedTrigger) {
            opener = page.getByRole("button", { name: nestedTrigger, exact: true });
            if (expandedTable || expandedDiagram) await opener.evaluate(element => { (window as unknown as { fixtureMarkdownInvoker: Element }).fixtureMarkdownInvoker = element; });
            if (expandedTable) {
              await page.evaluate(() => document.fonts.ready);
              inlineTableScroll = await page.locator(".cave-table-scroll").first().evaluate(element => {
                element.scrollLeft = Math.min(120, element.scrollWidth - element.clientWidth);
                return element.scrollLeft;
              });
              if (width === 390) expect(inlineTableScroll, "The populated inline table exercises horizontal scroll retention").toBeGreaterThan(0);
            }
            await opener.click();
          }
          expect(errors, `${consumer}: opening the component`).toEqual([]);
          if (consumer === "code-inspector" && width === 1440) {
            const inspector = page.getByRole("complementary", { name: "Reading snippet" });
            await expect(inspector).toBeVisible();
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await opener.focus();
            await expect(opener).toBeFocused();
            const box = await inspector.boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);
            expect(box!.y + box!.height).toBeLessThanOrEqual(height);
            await page.screenshot({ path: testInfo.outputPath(`${consumer}.png`), animations: "disabled" });
            await inspector.getByRole("button", { name: "Close the inspector", exact: true }).click();
            await expect(inspector).toHaveCount(0);
            expect(errors).toEqual([]);
            return;
          }
          const dialog = page.getByRole("dialog");
          await expect(dialog, consumer).toHaveCount(1);
          await expect(dialog, consumer).toBeVisible();
          await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
          await page.evaluate(() => document.fonts.ready);
          if (consumer === "chat-threads") {
            await dialog.getByRole("button", { name: /^Show \d+ more$/ }).click();
            await expect(dialog.getByRole("button", { name: new RegExp(`^${shellSessions[0].title} `) })).toBeVisible();
          }
          if (consumer.startsWith("rail-")) {
            await expect(dialog.locator("[data-terminal-host]")).toHaveCount(0);
            if (consumer.endsWith("-fullscreen")) {
              await expect(dialog.locator(".workspace-rail")).toHaveAttribute("data-fullscreen", "true");
              await expect(page.locator(".ui-modal-backdrop")).toHaveAttribute("data-presentation", "fullscreen");
            }
            if (consumer === "rail-files-fullscreen") {
              await expect(dialog.locator(".cm-content[contenteditable='true']")).toHaveText("# Synthetic rail draft retained across fullscreen changes.");
              await dialog.getByRole("button", { name: "Exit code rail fullscreen", exact: true }).click();
              await expect(page.locator(".ui-modal-backdrop")).toHaveAttribute("data-presentation", "sheet-right");
              await expect(dialog.locator(".cm-content[contenteditable='true']")).toHaveText("# Synthetic rail draft retained across fullscreen changes.");
              await dialog.getByRole("button", { name: "Expand code rail fullscreen", exact: true }).click();
            }
          }
          if (consumer === "wiki-source") await expect(dialog.getByRole("heading", { name: "Source review notes", exact: true })).toBeVisible();
          if (expandedTable) {
            await expect(dialog.locator("tbody tr")).toHaveCount(24);
            await dialog.locator(".cave-table-lightbox__body").evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = element.scrollHeight; });
            await expect(dialog.getByRole("cell", { name: "Synthetic source evidence for dependency 24", exact: true })).toBeInViewport();
          }
          if (expandedDiagram) {
            const level = dialog.locator(".cm-mermaid-viewer__level");
            const before = Number.parseInt(await level.innerText());
            await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
            expect(Number.parseInt(await level.innerText()), "Diagram zoom increases the scale").toBeGreaterThan(before);
            await dialog.getByRole("button", { name: "Fit to screen", exact: true }).click();
            if (theme.mode === "light") {
              const contrast = await dialog.locator(".cm-mermaid-viewer__stage").evaluate(element => {
                const edge = element.querySelector("path.flowchart-link")!;
                const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
                const context = canvas.getContext("2d")!;
                const luminance = (values: number[]) => {
                  const rgb = values.slice(0, 3).map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
                  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
                };
                const stroke = getComputedStyle(edge).stroke, background = getComputedStyle(element).backgroundColor;
                const ancestors: Element[] = [];
                for (let node: Element | null = element; node; node = node.parentElement) ancestors.push(node);
                context.fillStyle = "white"; context.fillRect(0, 0, 1, 1);
                for (const ancestor of ancestors.reverse()) { context.fillStyle = getComputedStyle(ancestor).backgroundColor; context.fillRect(0, 0, 1, 1); }
                const surface = luminance([...context.getImageData(0, 0, 1, 1).data]);
                context.fillStyle = stroke; context.fillRect(0, 0, 1, 1);
                const line = luminance([...context.getImageData(0, 0, 1, 1).data]);
                return { stroke, background, ratio: (Math.max(line, surface) + 0.05) / (Math.min(line, surface) + 0.05) };
              });
              await testInfo.attach("diagram-edge-contrast", { contentType: "application/json", body: JSON.stringify(contrast) });
              expect(contrast.ratio, "Diagram relationships stay distinguishable on the viewer canvas").toBeGreaterThanOrEqual(3);
            }
          }
          if (consumer === "studio-note") {
            await expect(dialog.locator("textarea").first()).toHaveValue(studioNoteText);
            expect(await dialog.locator(".familiar-studio-note-editor").evaluate(element => element.scrollWidth <= element.clientWidth), "The dated-note editor does not clip overflowing controls").toBe(true);
            const bodyRight = await dialog.locator(".ui-modal-body").evaluate(element => element.getBoundingClientRect().right);
            const controls = await dialog.locator("button").evaluateAll(elements => elements.map(element => ({ name: element.textContent, right: element.getBoundingClientRect().right })));
            for (const control of controls) expect(control.right, `Dated-note action stays inside the readable body: ${control.name}`).toBeLessThanOrEqual(bodyRight);
          }
          if (consumer === "studio-test") {
            await expect(dialog.getByText("Synthetic reply for layout review only.", { exact: true })).toBeVisible();
            expect(generationRequests).toHaveLength(1);
            expect(generationRequests[0]).toMatchObject({ familiarId: "fixture-review", permissionMode: "read" });
          }
          if (consumer.startsWith("auth-vault")) {
            await expect(dialog.locator(".vault-row")).toHaveCount(8);
            const rows = await dialog.locator(".vault-row").evaluateAll(elements => elements.map(element => {
              const main = element.querySelector(".vault-row-main")!;
              const description = element.querySelector(".vault-row-desc")!;
              const actions = element.querySelector(".vault-row-actions")!;
              return { width: main.clientWidth, scrollWidth: main.scrollWidth, descriptionRight: description.getBoundingClientRect().right, descriptionBottom: description.getBoundingClientRect().bottom, actionsLeft: actions.getBoundingClientRect().left, actionsTop: actions.getBoundingClientRect().top };
            }));
            for (const row of rows) {
              expect(row.scrollWidth, "Vault mapping labels and status badges remain readable").toBeLessThanOrEqual(row.width + 1);
              if (width === 390) expect(row.actionsTop >= row.descriptionBottom || row.actionsLeft >= row.descriptionRight, "Vault row actions do not cover its description").toBe(true);
            }
          }
          if (consumer === "auth-vault-add") {
            const spacing = await dialog.locator(".vault-paste-field").evaluate(element => {
              const input = element.querySelector("textarea")!;
              const actions = element.querySelector(".vault-paste-actions")!;
              const field = input.getBoundingClientRect(), buttons = actions.getBoundingClientRect();
              return { reserved: Number.parseFloat(getComputedStyle(input).paddingRight), required: field.right - buttons.left, below: buttons.top >= field.bottom };
            });
            await testInfo.attach("vault-value-spacing", { contentType: "application/json", body: JSON.stringify(spacing) });
            expect(spacing.below || spacing.reserved >= spacing.required, "Vault value text has space clear of Show and Paste").toBe(true);
          }
          if (consumer === "queue-issue") await expect(dialog.locator(".fwq-detail-title")).toHaveText("Review the project plan and preserve all authored dependencies");
          if (consumer === "scoped-long") {
            const body = dialog.locator(".ui-modal-body");
            expect(await body.evaluate(element => element.scrollHeight > element.clientHeight), "The long document scrolls inside the dialog").toBe(true);
            await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
            await expect(dialog.getByText("Final scoped document section.", { exact: true })).toBeInViewport();
            const shorterHeight = height - 160;
            await page.setViewportSize({ width, height: shorterHeight });
            await expect.poll(async () => { const frame = await dialog.boundingBox(); return frame!.y + frame!.height; }, { message: "The scoped dialog follows the visible viewport after resizing" }).toBeLessThanOrEqual(shorterHeight);
            expect((await dialog.boundingBox())!.y).toBeGreaterThanOrEqual(0);
            await page.setViewportSize({ width, height });
            await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
            await expect(dialog.getByText("Final scoped document section.", { exact: true })).toBeInViewport();
          }
          if (consumer === "board-approval") {
            await dialog.getByTitle("Show lifecycle details", { exact: true }).click();
            await expect(dialog.getByText("Approval is required before dispatching this task.", { exact: true })).toBeVisible();
            await expect(dialog.getByRole("button", { name: "Dispatch", exact: true })).toHaveCount(0);
          }
          if (consumer === "artifact-fullscreen") {
            const preview = await dialog.locator(".chat-artifact__frame").boundingBox();
            expect(preview!.height, "Refinement controls leave room to read the artifact").toBeGreaterThanOrEqual(Math.min(160, height * 0.2));
          }
          if (consumer === "chart-step") {
            const lane = await dialog.locator(".cr-sheet__stage").evaluate(element => ({
              width: element.clientWidth,
              scrollWidth: element.scrollWidth,
              labels: [...element.querySelectorAll(".cr-sheet__stage-current")].map(label => ({ width: label.clientWidth, scrollWidth: label.scrollWidth })),
            }));
            expect(lane.scrollWidth, "Lane controls fit inside their row").toBeLessThanOrEqual(lane.width + 1);
            for (const label of lane.labels) expect(label.scrollWidth, "Current lane remains readable").toBeLessThanOrEqual(label.width + 1);
          }
          if (consumer === "slot-picker") {
            expect(await dialog.locator(".x-comms-cell[aria-checked='true']").evaluate(element => getComputedStyle(element).backgroundColor), "Selected hour keeps its accent fill").not.toBe("rgba(0, 0, 0, 0)");
            const cells = await dialog.locator(".x-comms-heat-row").first().locator("button").evaluateAll(elements => elements.map(element => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right };
            }));
            for (let index = 1; index < cells.length; index++) expect(cells[index].left, "Each hour has a separate hit target").toBeGreaterThanOrEqual(cells[index - 1].right);
          }
          if (consumer === "mobile-handoff-off") {
            const content = await dialog.locator(".mobile-handoff").evaluate(element => {
              const frame = element.getBoundingClientRect();
              return [...element.children].map(child => ({ right: child.getBoundingClientRect().right, frameRight: frame.right, width: child.clientWidth, scrollWidth: child.scrollWidth }));
            });
            for (const part of content) {
              expect(part.right, "Pairing content stays inside the available width").toBeLessThanOrEqual(part.frameRight + 1);
              expect(part.scrollWidth, "Pairing instructions remain readable").toBeLessThanOrEqual(part.width + 1);
            }
          }
          if (consumer === "analytics-board") {
            const groups = await dialog.locator(".fa-segmented").evaluateAll(elements => elements.map(element => {
              const frame = element.getBoundingClientRect();
              return [...element.querySelectorAll("button")].map(button => ({ top: button.getBoundingClientRect().top, bottom: button.getBoundingClientRect().bottom, frameTop: frame.top, frameBottom: frame.bottom }));
            }));
            for (const buttons of groups) for (const button of buttons) {
              expect(button.top, "Segmented controls stay inside their group").toBeGreaterThanOrEqual(button.frameTop);
              expect(button.bottom, "Segmented labels and hit targets are not clipped").toBeLessThanOrEqual(button.frameBottom);
            }
          }
          const bounds = await dialog.boundingBox();
          if (consumer === "navigator-stats") {
            const names = await dialog.locator(".cr-chain__title").evaluateAll(elements => elements.map(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth })));
            expect(names.length, "Project statistics retain the populated roster").toBe(8);
            for (const name of names) {
              expect(name.width, "Project name has visible space").toBeGreaterThan(0);
              expect(name.scrollWidth, "Full project names stay readable in statistics").toBeLessThanOrEqual(name.width + 1);
            }
          }
          const closeControl = dialog.locator(".ui-modal-close");
          if (await closeControl.count()) expect(await closeControl.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          }), `${consumer}: the close control is above background content`).toBe(true);
          await testInfo.attach("layout-diagnostics", {
            contentType: "application/json",
            body: JSON.stringify(await dialog.evaluate(element => {
              const close = element.querySelector(".ui-modal-close");
              const ancestors = [];
              for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.push({ className: parent.className, rect: parent.getBoundingClientRect().toJSON(), scrollTop: parent.scrollTop, scrollHeight: parent.scrollHeight, overflowY: getComputedStyle(parent).overflowY });
              return {
                rect: element.getBoundingClientRect().toJSON(),
                ancestors,
                coarse: matchMedia("(pointer: coarse)").matches,
                touchPoints: navigator.maxTouchPoints,
                touchTarget: getComputedStyle(element).getPropertyValue("--touch-target"),
                close: close ? { width: close.getBoundingClientRect().width, minWidth: getComputedStyle(close).minWidth } : null,
                overflow: [element, ...element.querySelectorAll("*")].filter(node => node.scrollWidth > node.clientWidth + 1).slice(0, 50).map(node => ({ className: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth })),
              };
            }), null, 2),
          });
          expect(bounds!.x, consumer).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width, consumer).toBeLessThanOrEqual(width);
          expect(bounds!.y + bounds!.height, consumer).toBeLessThanOrEqual(height);
          expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), consumer).toBe(true);
          for (const part of [".ui-modal-header", ".ui-modal-footer"]) {
            const section = dialog.locator(part);
            if (await section.count()) expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth), `${consumer}: ${part}`).toBe(true);
          }
          for (const pill of await dialog.locator(".ui-modal-footer-pills > .ui-pill").all()) {
            expect(await pill.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${consumer}: footer metadata stays readable`).toBe(true);
          }
          if (consumer === "markdown-ready") {
            const entries = await dialog.locator(".chat-spec-reader__contents-link").evaluateAll(elements => elements.map(element => {
              const css = getComputedStyle(element);
              const line = Number.parseFloat(css.lineHeight) || Number.parseFloat(css.fontSize) * 1.2;
              return { height: element.clientHeight, required: line + Number.parseFloat(css.paddingTop) + Number.parseFloat(css.paddingBottom) };
            }));
            for (const entry of entries) expect(entry.height, "Contents labels retain their full line height").toBeGreaterThanOrEqual(entry.required - 1);
          }
          if (width === 390) {
            const targets = await dialog.locator("input:visible, select:visible, textarea:visible, button:visible, a.ui-btn:visible, a.drd-modal-row__action:visible").evaluateAll(elements => elements.map(element => {
              const input = element as HTMLInputElement;
              const target = /^(checkbox|radio)$/.test(input.type) ? element.closest("label") ?? element : element;
              const bounds = target.getBoundingClientRect();
              return { name: input.getAttribute("aria-label") || input.id || input.textContent?.trim() || input.type, width: bounds.width, height: bounds.height };
            }));
            for (const target of targets) {
              expect(target.width, `${consumer}: ${target.name} touch width`).toBeGreaterThanOrEqual(44);
              expect(target.height, `${consumer}: ${target.name} touch height`).toBeGreaterThanOrEqual(44);
            }
          }
          for (let step = 0; step < 6; step++) {
            await page.keyboard.press("Tab");
            expect(await dialog.evaluate(element => element.contains(document.activeElement)), consumer).toBe(true);
          }
          await page.screenshot({ path: testInfo.outputPath(`${consumer}.png`), animations: "disabled" });
          if (consumer === "chat-threads") await dialog.getByRole("button", { name: new RegExp(`^${shellSessions[0].title} `) }).click();
          else await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          if (expandedTable || expandedDiagram) {
            const retained = await opener.evaluate(element => {
              const old = (window as unknown as { fixtureMarkdownInvoker: Element }).fixtureMarkdownInvoker;
              return { sameInvoker: old === element, oldConnected: old.isConnected, activeTag: document.activeElement?.tagName };
            });
            await testInfo.attach("markdown-invoker-retention", { contentType: "application/json", body: JSON.stringify(retained) });
            expect(retained.sameInvoker, "Opening a viewer retains the injected source and its invoker").toBe(true);
            if (expandedTable) expect(await page.locator(".cave-table-scroll").first().evaluate(element => element.scrollLeft), "The inline table retains its reading position").toBe(inlineTableScroll);
          }
          if (consumer === "x-publish-confirm") await testInfo.attach("x-return-focus", { contentType: "application/json", body: JSON.stringify(await opener.evaluate(element => ({ disabled: (element as HTMLButtonElement).disabled, focused: document.activeElement === element, activeTag: document.activeElement?.tagName, activeText: document.activeElement?.textContent?.slice(0, 100) }))) });
          await expect(opener, consumer).toBeFocused();
          if (consumer === "x-publish-confirm") expect(xActions).toEqual(["draft"]);
          if (consumer.startsWith("rail-")) expect(fileWrites).toEqual([]);
          if (consumer === "artifact-fullscreen") await expect(page.getByRole("textbox", { name: "Describe the optimization you want", exact: true })).toHaveValue("Preserve this synthetic draft across fullscreen transitions.");
        expect(errors).toEqual([]);
      });
      }
    }
  });
}

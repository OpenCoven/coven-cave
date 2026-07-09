# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: grimoire-autosave.spec.ts >> grimoire autosave (desktop) >> memory files never autosave — typing leaves the draft unsaved
- Location: tests/grimoire-autosave.spec.ts:157:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.goto: Test timeout of 60000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:3100/?mode=grimoire", waiting until "load"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - navigation "Chat with familiars and view tasks" [ref=e5]:
    - search [ref=e6]:
      - searchbox "Search anything or ask Salem, the docs familiar" [ref=e7]
      - generic [ref=e8]: ⌘K
    - generic [ref=e9]:
      - button "Quick chat" [ref=e10] [cursor=pointer]
      - button "Select a familiar to enhance tasks" [disabled] [ref=e11] [cursor=pointer]
      - button "View tasks" [ref=e12] [cursor=pointer]
      - button "View schedules" [ref=e13] [cursor=pointer]
  - status [ref=e16]
  - alert [ref=e17]
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | // Grimoire MdEditor autosave — behavioral e2e (cave-78l, follow-up to cave-b2v).
  4   | //
  5   | // cave-b2v shipped debounced autosave for the Grimoire's knowledge and journal
  6   | // editors with source-scan tests only. This spec proves the runtime behavior:
  7   | //
  8   | //   1. Typing in a journal reflection fires a debounced POST /api/journal with
  9   | //      NO explicit Save click.
  10  | //   2. Typing in a knowledge entry fires a debounced POST /api/knowledge the
  11  | //      same way.
  12  | //   3. The memory editor stays explicit-save: typing never auto-PUTs
  13  | //      /api/memory/file (agents write those roots concurrently; a silent
  14  | //      autosave would race the mtime conflict guard).
  15  | //
  16  | // Daemon-less (COVEN_CAVE_E2E=1): every Grimoire data source is mocked via
  17  | // page.route. The editor is pinned to MARKDOWN mode through its
  18  | // `cave:md-editor:mode` preference so the spec drives the CodeMirror editor
  19  | // and never mounts Milkdown Crepe — the heavy visual editor whose cold
  20  | // compile made the crash-sweep flaky (cave-ae7).
  21  | 
  22  | const KNOWLEDGE_ENTRY = {
  23  |   id: "release-checklist",
  24  |   title: "Release checklist",
  25  |   tags: ["release"],
  26  |   scope: "global",
  27  |   enabled: true,
  28  |   body: "Stamp the version everywhere.",
  29  | };
  30  | 
  31  | const MEMORY_ENTRY = {
  32  |   relPath: "memory/notes.md",
  33  |   fullPath: "/home/e2e/.coven/memory/notes.md",
  34  |   modified: new Date().toISOString(),
  35  |   sourceKindLabel: "Coven native memory",
  36  |   rootLabel: "Coven memory",
  37  | };
  38  | 
  39  | const JOURNAL_DAY = "2026-07-01";
  40  | 
  41  | async function gotoGrimoire(page: Page) {
  42  |   await page.addInitScript(() => {
  43  |     window.localStorage.setItem("cave:onboarding:dismissed", "1");
  44  |     // Pin the shared MdEditor to MARKDOWN (CodeMirror) mode — typing goes
  45  |     // through the same updateRaw → debounce → save pipeline as VISUAL mode,
  46  |     // without Milkdown's cold-compile flake.
  47  |     window.localStorage.setItem("cave:md-editor:mode", "markdown");
  48  |   });
  49  |   await page.route("**/api/familiars**", (route) =>
  50  |     route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active" }] } }),
  51  |   );
  52  |   await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  53  |   await page.route("**/api/knowledge**", (route) => {
  54  |     if (route.request().method() === "POST") {
  55  |       return route.fulfill({ json: { ok: true, entry: { ...KNOWLEDGE_ENTRY } } });
  56  |     }
  57  |     return route.fulfill({ json: { ok: true, entries: [KNOWLEDGE_ENTRY] } });
  58  |   });
  59  |   await page.route("**/api/memory", (route) => route.fulfill({ json: { ok: true, entries: [MEMORY_ENTRY] } }));
  60  |   await page.route("**/api/memory/file**", (route) => {
  61  |     if (route.request().method() === "PUT") {
  62  |       memoryPuts.push(route.request().postDataJSON());
  63  |       return route.fulfill({ json: { ok: true, mtimeMs: 2000 } });
  64  |     }
  65  |     return route.fulfill({
  66  |       json: {
  67  |         ok: true,
  68  |         path: MEMORY_ENTRY.fullPath,
  69  |         revealed: true,
  70  |         text: "Remember the thing.",
  71  |         redactions: [],
  72  |         rawLength: 19,
  73  |         mtimeMs: 1000,
  74  |       },
  75  |     });
  76  |   });
  77  |   await page.route("**/api/journal**", (route) => {
  78  |     const req = route.request();
  79  |     if (req.method() === "POST") {
  80  |       return route.fulfill({ json: { ok: true, date: JOURNAL_DAY } });
  81  |     }
  82  |     if (new URL(req.url()).searchParams.get("date")) {
  83  |       return route.fulfill({
  84  |         json: {
  85  |           ok: true,
  86  |           date: JOURNAL_DAY,
  87  |           exists: true,
  88  |           entry: { reflectedBy: null, generatedAt: null, reflection: "Shipped the grimoire." },
  89  |           modified: null,
  90  |           stats: [],
  91  |           context: null,
  92  |         },
  93  |       });
  94  |     }
  95  |     return route.fulfill({
  96  |       json: { ok: true, days: [{ date: JOURNAL_DAY, preview: "Shipped the grimoire.", reflectedBy: null, modified: null }] },
  97  |     });
  98  |   });
  99  | 
> 100 |   await page.goto("/?mode=grimoire");
      |              ^ Error: page.goto: Test timeout of 60000ms exceeded.
  101 |   await page.waitForSelector(".grimoire-view", { timeout: 30_000 });
  102 | }
  103 | 
  104 | // PUT bodies captured by the memory-file mock, reset per test (the negative
  105 | // case asserts none arrive while typing).
  106 | let memoryPuts: Array<Record<string, unknown>> = [];
  107 | 
  108 | test.beforeEach(() => {
  109 |   memoryPuts = [];
  110 | });
  111 | 
  112 | /** Click into the last CodeMirror line (the document body — below any
  113 |  *  frontmatter) and type there. */
  114 | async function typeInEditor(page: Page, text: string) {
  115 |   const lastLine = page.locator(".grimoire-view .cm-line").last();
  116 |   await lastLine.waitFor({ timeout: 30_000 });
  117 |   await lastLine.click();
  118 |   await page.keyboard.type(text);
  119 | }
  120 | 
  121 | test.describe("grimoire autosave (desktop)", () => {
  122 |   test("journal reflections autosave after the debounce — no Save click", async ({ page }) => {
  123 |     await gotoGrimoire(page);
  124 |     // The rail formats journal dates through datetime prefs ("Jul 1" /
  125 |     // "1 Jul", + year when not current) — match the row by its preview text,
  126 |     // which is stable across pref and clock-year changes.
  127 |     await page.getByRole("button", { name: /Shipped the grimoire\./ }).click();
  128 | 
  129 |     const posted = page.waitForRequest(
  130 |       (req) => req.method() === "POST" && req.url().includes("/api/journal"),
  131 |       { timeout: 15_000 },
  132 |     );
  133 |     await typeInEditor(page, " More reflection.");
  134 |     const req = await posted;
  135 | 
  136 |     const body = req.postDataJSON() as { date?: string; reflection?: string };
  137 |     expect(body.date).toBe(JOURNAL_DAY);
  138 |     expect(body.reflection).toContain("More reflection.");
  139 |   });
  140 | 
  141 |   test("knowledge entries autosave after the debounce — no Save click", async ({ page }) => {
  142 |     await gotoGrimoire(page);
  143 |     await page.getByRole("button", { name: /Release checklist/ }).click();
  144 | 
  145 |     const posted = page.waitForRequest(
  146 |       (req) => req.method() === "POST" && req.url().includes("/api/knowledge"),
  147 |       { timeout: 15_000 },
  148 |     );
  149 |     await typeInEditor(page, " Tag the release.");
  150 |     const req = await posted;
  151 | 
  152 |     const body = req.postDataJSON() as { id?: string; body?: string };
  153 |     expect(body.id).toBe(KNOWLEDGE_ENTRY.id);
  154 |     expect(body.body).toContain("Tag the release.");
  155 |   });
  156 | 
  157 |   test("memory files never autosave — typing leaves the draft unsaved", async ({ page }) => {
  158 |     await gotoGrimoire(page);
  159 |     await page.getByRole("button", { name: /notes\.md/ }).click();
  160 | 
  161 |     await typeInEditor(page, " A new fact.");
  162 |     // The editor tracks the draft as dirty (manual-save surface)…
  163 |     await expect(page.getByText("Unsaved changes")).toBeVisible();
  164 |     // …and well past the 1.2s autosave debounce, still nothing was written.
  165 |     await page.waitForTimeout(3_500);
  166 |     expect(memoryPuts).toHaveLength(0);
  167 |     await expect(page.getByText("Unsaved changes")).toBeVisible();
  168 | 
  169 |     // The explicit Save path still works and is the only write.
  170 |     await page.getByRole("button", { name: /^Save$/ }).click();
  171 |     await expect.poll(() => memoryPuts.length, { timeout: 10_000 }).toBe(1);
  172 |     const body = memoryPuts[0] as { path?: string; text?: string; expectedMtimeMs?: number };
  173 |     expect(body.path).toBe(MEMORY_ENTRY.fullPath);
  174 |     expect(body.text).toContain("A new fact.");
  175 |     expect(body.expectedMtimeMs).toBe(1000);
  176 |   });
  177 | });
  178 | 
```
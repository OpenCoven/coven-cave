import { expect, test, type Page } from "@playwright/test";

// Proposal-review receipt card (#5520), daemon-less: an assistant turn
// carrying a <coven:proposal-review …/> marker renders an evidence-only card
// (verdict, subject, reviewer answers with confidence, the fixed evidence
// line) with no approve/deny control, the raw marker never shows, and a
// fenced marker stays literal example text. Every API surface is
// page.route-mocked (COVEN_CAVE_E2E=1).

test.use({ serviceWorkers: "block" });

const SESSION = "proposal-review";
const ISO = "2026-09-22T09:00:00.000Z";
const MARKER =
  '<coven:proposal-review tool="propose_patch" target="src/x.ts" verdict="proposal_only" reviewer="jev-1.13.0" q="addresses_task:yes:0.93|evidence_supports:yes:0.91|unrelated_changes:no:0.96|needs_clarification:yes:0.88" reason="needs clarification" />';
const REPLY = ["Here is the proposed patch.", MARKER, "Tell me if you want it applied."].join("\n");
const FENCED_REPLY = ["The marker looks like this:", "```", MARKER, "```", "That is example text."].join("\n");

async function setup(page: Page, text: string) {
  const turns = [
    { id: "u1", parentId: null, role: "user", text: "Review the patch.", createdAt: ISO },
    { id: "a1", parentId: "u1", role: "assistant", text, createdAt: ISO },
  ];
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:familiar:cody:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    familiars: [{ id: "cody", display_name: "Cody", role: "Code familiar", status: "active", icon: "ph:code" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{
      id: SESSION, title: "Proposal review", status: "idle", project_root: "/tmp/coven-cave",
      harness: "claude", familiarId: "cody", model: "test", runtime: "local:/tmp/coven-cave",
      exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO,
    }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "p1", name: "Cave", root: "/tmp/coven-cave", access: "write" }],
  } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: {
    ok: true, state: { familiarId: "cody", harness: "claude", effectiveModel: "test", source: "session", applicationState: "saved" },
  } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true,
    conversation: { activeLeafId: "a1", turns },
  } }));
  await page.goto(`/?mode=chat#chat-${SESSION}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.getByText("Review the patch.", { exact: true })).toBeVisible({ timeout: 45_000 });
  return chat;
}

test("a proposal-review marker renders an evidence-only receipt card in place", async ({ page }) => {
  const chat = await setup(page, REPLY);
  const card = chat.getByRole("group", { name: /^Proposal review: review: proposal only/ });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-verdict", "proposal_only");
  await expect(card).toContainText("propose_patch → src/x.ts");
  await expect(card).toContainText("needs clarification");
  await expect(card).toContainText("addresses task");
  await expect(card).toContainText("93% confidence");
  await expect(card).toContainText("jev-1.13.0");
  await expect(card).toContainText("Review verdicts are evidence, not permission.");
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(chat.getByRole("button", { name: /^(Approve|Deny)$/ })).toHaveCount(0);
  // Prose on both sides of the marker survives; the raw marker never shows.
  await expect(chat.getByText("Here is the proposed patch.", { exact: true })).toBeVisible();
  await expect(chat.getByText("Tell me if you want it applied.", { exact: true })).toBeVisible();
  await expect(chat.locator(".cave-bubble-assistant, [data-turn-id]").last()).not.toContainText("<coven:proposal-review");
});

test("a fenced proposal-review marker stays literal example text", async ({ page }) => {
  const chat = await setup(page, FENCED_REPLY);
  await expect(chat.getByText("That is example text.", { exact: true })).toBeVisible();
  await expect(chat.getByRole("group", { name: /^Proposal review:/ })).toHaveCount(0);
  await expect(chat.locator("code", { hasText: "coven:proposal-review" }).first()).toBeVisible();
});

// A live marker and a fenced one in the same reply: fence tracking must not
// leak across them. The fenced example uses verdict="permit" so a leaked
// card would be unmistakable, and the live card must still be a receipt with
// no interactive control of any kind.
const FENCED_PERMIT = '<coven:proposal-review tool="fenced_example" verdict="permit" />';
const MIXED_REPLY = [
  "Here is the proposed patch.",
  MARKER,
  "The marker looks like this:",
  "```text",
  FENCED_PERMIT,
  "```",
  "That is example text.",
].join("\n");

test("a live marker and a fenced marker in one reply yield exactly one card", async ({ page }) => {
  const chat = await setup(page, MIXED_REPLY);
  await expect(chat.getByText("That is example text.", { exact: true })).toBeVisible();
  const cards = chat.getByRole("group", { name: /^Proposal review:/ });
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-verdict", "proposal_only");
  await expect(chat.locator('[data-verdict="permit"]')).toHaveCount(0);
  await expect(chat.locator("pre, code").filter({ hasText: 'tool="fenced_example"' }).first()).toBeVisible();
  await expect(cards.first().locator("button, a, input, [role=button], meter, progress")).toHaveCount(0);
});

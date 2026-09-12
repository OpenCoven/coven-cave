// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/components/ui/select", () => ({
  StandardSelect: ({ label, value, onChange, options }) => createElement("select", {
    "aria-label": label, value, onChange: (event) => onChange(event.target.value),
  }, options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label))),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const renderers = [];
let ReminderLinkField;
beforeEach(async () => {
  vi.resetModules();
  ({ ReminderLinkField } = await import("./reminder-link-field"));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(async () => {
  await act(async () => renderers.splice(0).forEach((renderer) => renderer.unmount()));
  vi.unstubAllGlobals();
});

async function mount(value = null) {
  const onChange = vi.fn();
  let renderer;
  await act(async () => { renderer = create(createElement(ReminderLinkField, { value, onChange })); });
  renderers.push(renderer);
  return { renderer, onChange };
}
async function chooseKind(renderer, value) {
  await act(async () => renderer.root.findByProps({ "aria-label": "Link kind" }).props.onChange({ target: { value } }));
}
function sessionOptions(renderer) {
  return renderer.root.findByProps({ "aria-label": "Chat session" }).findAllByType("option")
    .map((option) => ({ id: option.props.value, title: option.children.join("") }));
}
function sessionsResponse(sessions) {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ sessions }) });
}

test("only ordinary Chat rows enter reminder options or the cross-mount cache", async () => {
  sessionsResponse([
    { id: "human", title: "A chat", origin: "chat" },
    { id: "human-flow-title", title: "Flow: my deployment plan", origin: "chat" },
    { id: "unclassified-flow-title", title: "Flow: brainstorming" },
    { id: "flow", title: "An ordinary-looking execution", origin: "flow" },
    { id: "generated", title: "A generated run", origin: "chat", generated: true },
    { id: "canvas", title: "Canvas output", origin: "canvas" },
    { id: "cron", title: "Scheduled output", origin: "cron" },
    { id: "heartbeat", title: "Heartbeat output", origin: "heartbeat" },
    { id: "journal", title: "Journal output", origin: "journal" },
    { id: "enhance", title: "Enhance output", origin: "enhance" },
    { id: "board", title: "Task discussion", origin: "board" },
  ]);
  const { renderer } = await mount();
  await chooseKind(renderer, "session");
  const expected = [
    { id: "", title: "Select a session…" },
    { id: "human", title: "A chat" },
    { id: "human-flow-title", title: "Flow: my deployment plan" },
    { id: "unclassified-flow-title", title: "Flow: brainstorming" },
    { id: "board", title: "Task discussion" },
  ];
  expect(sessionOptions(renderer)).toEqual(expected);
  const { renderer: reopened } = await mount();
  await chooseKind(reopened, "session");
  expect(sessionOptions(reopened)).toEqual(expected);
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/sessions/list", { cache: "no-store" });
});

test("filtering does not replace or clear a saved execution link", async () => {
  sessionsResponse([
    { id: "saved-flow", title: "Existing execution", origin: "flow" },
    { id: "human", title: "Human discussion", origin: "chat" },
  ]);
  const value = { kind: "session", ref: "saved-flow" };
  const { renderer, onChange } = await mount(value);
  expect(onChange).not.toHaveBeenCalled();
  await chooseKind(renderer, "session");
  expect(onChange).toHaveBeenCalledExactlyOnceWith(value);
  expect(renderer.root.findByProps({ "aria-label": "Chat session" }).props.value).toBe("saved-flow");
  expect(sessionOptions(renderer).map((option) => option.id)).not.toContain("saved-flow");
});

test("a failed session load keeps the error visible and permits another attempt", async () => {
  fetch.mockRejectedValueOnce(new Error("offline"));
  const { renderer, onChange } = await mount({ kind: "session", ref: "saved-chat" });
  await chooseKind(renderer, "session");
  expect(JSON.stringify(renderer.toJSON())).toContain("Couldn't load chat sessions.");
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ kind: "session", ref: "saved-chat" });
  sessionsResponse([{ id: "human", title: "Human discussion", origin: "chat" }]);
  await chooseKind(renderer, "session");
  expect(sessionOptions(renderer).map((option) => option.id)).toEqual(["", "human"]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("a generated-only result uses the existing empty Chat state", async () => {
  sessionsResponse([{ id: "flow", title: "Execution", origin: "flow" }]);
  const { renderer } = await mount();
  await chooseKind(renderer, "session");
  expect(JSON.stringify(renderer.toJSON())).toContain("No chat sessions yet.");
});

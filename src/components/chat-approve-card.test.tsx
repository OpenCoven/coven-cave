// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ChatApproveCard } from "./chat-approve-card";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
const announce = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce }) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("requestAnimationFrame", (callback) => { callback(); return 0; });

const request = {
  kind: "questions",
  questions: [
    { id: "auth", prompt: "Which auth?", options: ["Cookies", "JWT"], allowOther: true },
    { id: "store", prompt: "Which store?", options: ["SQLite", "Postgres"], allowOther: false },
  ],
};
const renderers = [];
afterEach(async () => {
  for (const renderer of renderers.splice(0)) await act(async () => renderer.unmount());
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function mount(props = {}) {
  const onSubmit = vi.fn(async () => ({ ok: true }));
  let renderer;
  await act(async () => {
    renderer = create(<ChatApproveCard request={request} onSubmit={onSubmit} {...props} />);
  });
  renderers.push(renderer);
  return { renderer, onSubmit };
}
function radios(renderer) {
  return renderer.root.findAllByType("input").filter((node) => node.props.type === "radio");
}
function formSubmit(renderer) {
  renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
}
function button(renderer, label) {
  return renderer.root.findAllByType("button").find((node) => node.props.children.includes(label));
}

test("mounting, choosing, and elapsed time never send; explicit submit sends ordered answers", async () => {
  vi.useFakeTimers();
  const { renderer, onSubmit } = await mount();
  await act(async () => {
    radios(renderer)[0].props.onChange();
    radios(renderer)[4].props.onChange();
    vi.advanceTimersByTime(60_000);
  });
  expect(onSubmit).not.toHaveBeenCalled();
  await act(async () => formSubmit(renderer));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
    answers: { auth: "Cookies", store: "Postgres" },
    text: "Which auth? → Cookies\nWhich store? → Postgres",
  });
  expect(renderer.root.findByProps({ "data-approve-phase": "sent" })).toBeDefined();
  expect(announce).toHaveBeenCalledWith("Answers sent.");
});

test("Other clears the old option and preserves internal spaces while typing", async () => {
  const { renderer, onSubmit } = await mount();
  await act(async () => radios(renderer)[0].props.onChange());
  await act(async () => radios(renderer)[2].props.onChange());
  const input = () => renderer.root.findAllByType("input").find((node) => node.props.type === "text");
  await act(async () => input().props.onChange({ target: { value: "OAuth " } }));
  expect(input().props.value).toBe("OAuth ");
  await act(async () => input().props.onChange({ target: { value: "OAuth only " } }));
  await act(async () => formSubmit(renderer));
  expect(onSubmit.mock.calls[0][0].text).toBe("Which auth? → OAuth only");
});

test("no answers cannot send, and Skip never invokes the host", async () => {
  const { renderer, onSubmit } = await mount();
  expect(button(renderer, "Send answers").props.disabled).toBe(true);
  await act(async () => formSubmit(renderer));
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("Choose an option");
  await act(async () => button(renderer, "Skip").props.onClick());
  expect(onSubmit).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ "data-approve-phase": "skipped" })).toBeDefined();
});

test("submission is single-flight and never reports sent before acknowledgement", async () => {
  let resolve;
  const onSubmit = vi.fn(() => new Promise((done) => { resolve = done; }));
  const { renderer } = await mount({ onSubmit });
  await act(async () => radios(renderer)[0].props.onChange());
  await act(async () => { formSubmit(renderer); formSubmit(renderer); });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByProps({ "data-approve-phase": "sending" })).toBeDefined();
  expect(announce).not.toHaveBeenCalledWith("Answers sent.");
  await act(async () => resolve({ ok: true }));
  expect(renderer.root.findByProps({ "data-approve-phase": "sent" })).toBeDefined();
});

test.each([
  { disabledReason: "Offline copies are read only." },
  { disabledReason: "Wait for the current response." },
  { disabledReason: "This request is from an earlier turn." },
])("disabled host state cannot submit: $disabledReason", async (props) => {
  const { renderer, onSubmit } = await mount(props);
  expect(renderer.root.findAllByType("fieldset").every((node) => node.props.disabled)).toBe(true);
  await act(async () => formSubmit(renderer));
  expect(onSubmit).not.toHaveBeenCalled();
});

test.each([
  vi.fn(async () => ({ ok: false, error: "Request rejected. Choose a project." })),
  vi.fn(async () => { throw new Error("Network failed. Try again."); }),
])("failed submission keeps answers and surfaces the error", async (onSubmit) => {
  const { renderer } = await mount({ onSubmit });
  await act(async () => radios(renderer)[1].props.onChange());
  await act(async () => formSubmit(renderer));
  expect(renderer.root.findByProps({ "data-approve-phase": "asking" })).toBeDefined();
  expect(renderer.root.findByProps({ role: "alert" }).children.length).toBeGreaterThan(0);
  expect(radios(renderer)[1].props.checked).toBe(true);
  expect(announce).not.toHaveBeenCalledWith("Answers sent.");
});

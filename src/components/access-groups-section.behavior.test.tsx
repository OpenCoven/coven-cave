// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/lib/icon", () => ({ Icon: () => <span /> }));
import { AccessGroupsSection } from "./access-groups-section";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

const payloads = {
  "/api/access-groups": { ok: true, accessGroups: [] },
  "/api/projects": { ok: true, projects: [] },
  "/api/project-grants": { ok: true, grants: [], supremeFamiliarId: null },
};

// Removing response validation must turn these into a false empty collection.
for (const endpoint of Object.keys(payloads)) {
  test.each(["http", "network", "json", "payload"])(`${endpoint} %s failure shows Retry, never an empty collection`, async (failure) => {
    let failing = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (failing && url === endpoint) {
        if (failure === "network") throw new Error("fixture disconnected");
        if (failure === "json") return new Response("not json", { status: 200 });
        if (failure === "http") return Response.json(payloads[url], { status: 503 });
        return Response.json({ ok: false, error: "private backend detail" });
      }
      return Response.json(payloads[url]);
    }));
    await act(async () => { renderer = create(<AccessGroupsSection familiars={[]} />); });
    const failed = JSON.stringify(renderer!.toJSON());
    expect(failed).toContain("Couldn’t load access groups.");
    expect(failed).not.toContain("No access groups yet.");
    expect(failed).not.toContain("private backend detail");
    const retry = renderer!.root.findAllByType("button").find(button =>
      button.children.includes("Retry"));
    expect(retry).toBeDefined();
    failing = false;
    await act(async () => { retry!.props.onClick(); });
    const recovered = JSON.stringify(renderer!.toJSON());
    expect(recovered).toContain("No access groups yet.");
    expect(recovered).not.toContain("Couldn’t load access groups.");
  });
}

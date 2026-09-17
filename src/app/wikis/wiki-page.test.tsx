import { expect, test, vi } from "vitest";
const store = vi.hoisted(() => ({ manifest: vi.fn(), page: vi.fn() }));
vi.mock("@/lib/covenwiki-store", () => ({ createCovenWikiStore: () => store }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
vi.mock("@/components/covenwiki-reader", () => ({ CovenWikiReader: () => null }));
import WikiPage from "./[repo]/[[...slug]]/page";

test("HTML route returns a manifest-only shell and rejects unknown or unsafe routes", async () => {
  const manifest = { slug: "demo", pages: [{ slug: "overview" }] };
  store.manifest.mockResolvedValue(manifest);
  const rendered = await WikiPage({ params: Promise.resolve({ repo: "demo", slug: ["overview"] }) });
  expect(rendered.props.manifest).toBe(manifest);
  expect(rendered.props.slug).toBe("overview");
  expect(store.page).not.toHaveBeenCalled();
  for (const slug of [["missing"], ["overview", "extra"], [".."], ["%2fetc"]]) {
    await expect(WikiPage({ params: Promise.resolve({ repo: "demo", slug }) })).rejects.toThrow("404");
  }
  store.manifest.mockClear();
  await expect(WikiPage({ params: Promise.resolve({ repo: "../demo" }) })).rejects.toThrow("404");
  expect(store.manifest).not.toHaveBeenCalled();
  store.manifest.mockResolvedValue(null);
  await expect(WikiPage({ params: Promise.resolve({ repo: "missing" }) })).rejects.toThrow("404");
});

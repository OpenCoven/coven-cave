import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localPathFromHref } from "./local-path-link.ts";

describe("localPathFromHref", () => {
  it("reads absolute POSIX paths under filesystem roots, without line references", () => {
    assert.equal(localPathFromHref("/Users/me/notes/report.md"), "/Users/me/notes/report.md");
    assert.equal(localPathFromHref("/Users/me/src/app.ts:42"), "/Users/me/src/app.ts");
    assert.equal(localPathFromHref("/Users/me/src/app.ts:42:7"), "/Users/me/src/app.ts");
    assert.equal(localPathFromHref("/home/me/a.md#L12"), "/home/me/a.md");
    assert.equal(localPathFromHref("/private/tmp/My%20Folder"), "/private/tmp/My Folder");
    assert.equal(localPathFromHref("  /tmp/x  "), "/tmp/x");
  });

  it("leaves app routes, web links and fragments to the web opener", () => {
    for (const href of [
      "/settings",
      "/settings#daemon",
      "/#chat-abc",
      "/quick-chat?view=window",
      "/api/sessions/list",
      "https://example.com/Users/me",
      "http://127.0.0.1:3020/Users/me/x.md",
      "mailto:someone@example.com",
      "#cite-1",
      "?q=1",
      "//cdn.example.com/x.js",
      "",
    ]) {
      assert.equal(localPathFromHref(href, "/Users/me/project"), null, href);
    }
  });

  it("reads file URLs on this machine and refuses network shares", () => {
    assert.equal(localPathFromHref("file:///Users/me/My%20Docs/a.pdf"), "/Users/me/My Docs/a.pdf");
    assert.equal(localPathFromHref("file://localhost/tmp/a.txt"), "/tmp/a.txt");
    assert.equal(localPathFromHref("file:///C:/Users/me/a.txt"), "C:\\Users\\me\\a.txt");
    assert.equal(localPathFromHref("file://fileserver/share/a.txt"), null);
  });

  it("keeps home-relative paths for the shell to expand", () => {
    assert.equal(localPathFromHref("~/notes"), "~/notes");
    assert.equal(localPathFromHref("~"), "~");
    assert.equal(localPathFromHref("~someone/notes"), null);
  });

  it("reads Windows drive paths, which would otherwise look like a scheme", () => {
    assert.equal(localPathFromHref("C:\\Users\\me\\a.txt"), "C:\\Users\\me\\a.txt");
    assert.equal(localPathFromHref("D:/work/a.txt:3"), "D:/work/a.txt");
  });

  it("resolves project-relative paths only when the chat has a project", () => {
    const root = "/Users/me/project";
    assert.equal(localPathFromHref("docs/guide.md", root), "/Users/me/project/docs/guide.md");
    assert.equal(localPathFromHref("src/app.ts#L10-L20", root), "/Users/me/project/src/app.ts");
    assert.equal(localPathFromHref("./README.md", root), "/Users/me/project/README.md");
    assert.equal(localPathFromHref("README.md", root), "/Users/me/project/README.md");
    assert.equal(localPathFromHref("../sibling/x.md", root), "/Users/me/sibling/x.md");
    assert.equal(localPathFromHref("src/", "/Users/me/project/"), "/Users/me/project/src");
    assert.equal(localPathFromHref("docs/guide.md"), null, "no project, no guess");
    assert.equal(localPathFromHref("justaword", root), null, "a bare word is not a path");
    assert.equal(localPathFromHref("src\\app.ts", "C:\\work\\proj"), "C:\\work\\proj\\src\\app.ts");
    assert.equal(localPathFromHref("..\\..\\..\\x", "C:\\work"), "C:\\x", "never climbs past the drive");
  });
});

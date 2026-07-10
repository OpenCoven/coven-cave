// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractHeadingSection,
  githubApiTarget,
  htmlToText,
  isPrivateIp,
} from "./pin-sources.ts";

describe("isPrivateIp — SSRF guard ranges", () => {
  it("blocks loopback, private, link-local, CGNAT, multicast v4", () => {
    for (const addr of [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      assert.equal(isPrivateIp(addr), true, addr);
    }
  });

  it("allows public v4", () => {
    for (const addr of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.0.1"]) {
      assert.equal(isPrivateIp(addr), false, addr);
    }
  });

  it("blocks loopback, ULA, link-local, and v4-mapped-private v6", () => {
    for (const addr of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1"]) {
      assert.equal(isPrivateIp(addr), true, addr);
    }
    assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
    assert.equal(isPrivateIp("::ffff:8.8.8.8"), false);
  });

  it("treats non-IP strings as blocked (resolve first)", () => {
    assert.equal(isPrivateIp("localhost"), true);
    assert.equal(isPrivateIp(""), true);
  });
});

describe("htmlToText", () => {
  it("extracts title and readable text, dropping script/style", () => {
    const { title, text } = htmlToText(
      "<html><head><title>My  Page</title><style>p{}</style></head>" +
        "<body><script>evil()</script><h1>Hello</h1><p>World &amp; friends</p></body></html>",
    );
    assert.equal(title, "My Page");
    assert.match(text, /Hello/);
    assert.match(text, /World & friends/);
    assert.doesNotMatch(text, /evil/);
    assert.doesNotMatch(text, /p\{\}/);
  });

  it("drops script blocks even with whitespace/attribute end tags", () => {
    const { text } = htmlToText("<p>keep</p><script>evil()</script ><p>also</p><style media='x'>s{}</style\t><p>end</p>");
    assert.doesNotMatch(text, /evil/);
    assert.doesNotMatch(text, /s\{\}/);
    assert.match(text, /keep/);
    assert.match(text, /also/);
    assert.match(text, /end/);
  });

  it("decodes numeric entities and keeps line structure", () => {
    const { text } = htmlToText("<p>a&#39;b</p><p>next</p>");
    assert.match(text, /a'b/);
    assert.match(text, /\n/);
  });
});

describe("extractHeadingSection", () => {
  const doc = "# Top\nintro\n\n## Alpha\na-body\n\n### Deep\nd-body\n\n## Beta\nb-body\n";

  it("slices one section through the next same-or-higher heading", () => {
    const section = extractHeadingSection(doc, "Alpha");
    assert.match(section, /^## Alpha/);
    assert.match(section, /a-body/);
    assert.match(section, /d-body/, "nested deeper headings stay inside");
    assert.doesNotMatch(section, /b-body/);
  });

  it("returns the whole doc for empty or missing headings", () => {
    assert.equal(extractHeadingSection(doc, ""), doc);
    assert.equal(extractHeadingSection(doc, "Nope"), doc);
  });

  it("matches case-insensitively", () => {
    assert.match(extractHeadingSection(doc, "beta"), /b-body/);
  });
});

describe("githubApiTarget", () => {
  it("maps repo roots to the readme endpoint", () => {
    const t = githubApiTarget(new URL("https://github.com/OpenCoven/coven-cave"));
    assert.equal(t.api, "https://api.github.com/repos/OpenCoven/coven-cave/readme");
    assert.equal(t.json, "repo");
  });

  it("maps issues and PRs to the issues endpoint", () => {
    const issue = githubApiTarget(new URL("https://github.com/o/r/issues/42"));
    assert.equal(issue.api, "https://api.github.com/repos/o/r/issues/42");
    const pr = githubApiTarget(new URL("https://github.com/o/r/pull/7"));
    assert.equal(pr.api, "https://api.github.com/repos/o/r/issues/7");
  });

  it("maps blob URLs to raw.githubusercontent.com", () => {
    const t = githubApiTarget(new URL("https://github.com/o/r/blob/main/docs/guide.md"));
    assert.equal(t.api, "https://raw.githubusercontent.com/o/r/main/docs/guide.md");
    assert.equal(t.json, "raw");
  });

  it("rejects unsupported or unsafe paths", () => {
    assert.equal(githubApiTarget(new URL("https://github.com/onlyowner")), null);
    assert.equal(githubApiTarget(new URL("https://github.com/o/r/actions")), null);
    assert.equal(githubApiTarget(new URL("https://github.com/o/r/issues/notanumber")), null);
    assert.equal(githubApiTarget(new URL("https://github.com/o/r/blob/main/..%2f..%2fetc")), null, "encoded traversal");
  });
});

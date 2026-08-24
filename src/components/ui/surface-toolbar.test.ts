// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { Children, createElement } from "react";
import { act, create } from "react-test-renderer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = readFileSync(new URL("./surface-toolbar.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles/globals/primitives.css", import.meta.url), "utf8");

const require = createRequire(import.meta.url);
const originalSucraseOptions = process.env.SUCRASE_OPTIONS;
process.env.SUCRASE_OPTIONS = JSON.stringify({ jsxRuntime: "automatic" });
require("sucrase/register/tsx");
if (originalSucraseOptions === undefined) delete process.env.SUCRASE_OPTIONS;
else process.env.SUCRASE_OPTIONS = originalSucraseOptions;
const Module = require("node:module");
const originalResolveFilename = Module._resolveFilename;
const suffixes = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
  let base = null;
  if (request.startsWith("@/")) {
    base = path.join(process.cwd(), "src", request.slice(2));
  } else if ((request.startsWith("./") || request.startsWith("../")) && parent?.filename) {
    base = path.resolve(path.dirname(parent.filename), request);
  }
  if (base) {
    for (const suffix of suffixes) {
      if (existsSync(base + suffix)) return base + suffix;
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const { SurfaceToolbar } = require("./surface-toolbar.tsx");
const { Button } = require("./button.tsx");
const { OverflowMenu } = require("./overflow-menu.tsx");
const { PopoverItem } = require("./popover.tsx");
const { ViewHeader } = require("./view-header.tsx");
Module._resolveFilename = originalResolveFilename;

assert.match(source, /from "\.\/view-header"/, "SurfaceToolbar composes the shared ViewHeader");
assert.match(source, /from "\.\/button"/, "SurfaceToolbar reuses the shared Button primitive");
assert.match(source, /from "\.\/overflow-menu"/, "SurfaceToolbar reuses the shared OverflowMenu scaffold");
assert.match(source, /partitionSurfaceToolbarActions/, "SurfaceToolbar reuses the shared action partition helper");
assert.match(source, /ui-surface-toolbar__controls/, "SurfaceToolbar renders the shared controls wrapper");
assert.match(source, /overflowAriaLabel = "More surface actions"/, "overflow trigger uses a stable descriptive label by default");
assert.match(
  styles,
  /\.ui-surface-toolbar\s*\{[^}]*container-name:\s*view-header surface-toolbar-controls;/,
  "the toolbar root owns both container names so responsive rules can style the controls row",
);
assert.doesNotMatch(
  styles,
  /\.ui-surface-toolbar__controls\s*\{[^}]*container:\s*surface-toolbar-controls/,
  "the controls row must not be the container that its own responsive rule targets",
);

function elementText(children) {
  return Array.isArray(children) ? children.join("") : String(children ?? "");
}

test("renders title metadata, enforces the three-action chrome budget, and preserves overflow callbacks and disabled state", async () => {
  const calls = [];
  let renderer = null;

  await act(async () => {
    renderer = create(
      createElement(SurfaceToolbar, {
        eyebrow: "Projects",
        title: "Workspace",
        subtitle: "Shared codebases",
        search: createElement("input", { "aria-label": "Search projects" }),
        filters: createElement("span", { className: "filter-chip" }, "Owned by me"),
        actions: [
          {
            id: "refresh",
            label: "Refresh",
            placement: "visible",
            icon: "ph:arrows-clockwise-bold",
            onSelect: () => calls.push("refresh"),
          },
          {
            id: "create",
            label: "Create task",
            placement: "primary",
            icon: "ph:plus-bold",
            onSelect: () => calls.push("create"),
          },
          {
            id: "pin",
            label: "Pin view",
            placement: "visible",
            icon: "ph:push-pin",
            disabled: true,
            onSelect: () => calls.push("pin"),
          },
          {
            id: "history",
            label: "View history",
            placement: "overflow",
            icon: "ph:rows",
            onSelect: () => calls.push("history"),
          },
          {
            id: "archive",
            label: "Archive view",
            placement: "visible",
            icon: "ph:tray",
            onSelect: () => calls.push("archive"),
          },
          {
            id: "settings",
            label: "Open settings",
            placement: "overflow",
            icon: "ph:gear-six-bold",
            disabled: true,
            onSelect: () => calls.push("settings"),
          },
        ],
      }),
    );
  });

  const root = renderer.root;
  const header = root.findByType(ViewHeader);
  assert.equal(header.props.search.props["aria-label"], "Search projects");
  assert.equal(
    root.findByProps({ className: "ui-surface-toolbar__subtitle" }).children.join(""),
    "Shared codebases",
    "subtitle renders inside the shared title stack",
  );

  const controls = root.findByProps({ className: "ui-surface-toolbar__controls" });
  assert.ok(
    Children.toArray(controls.props.children).some(
      (child) => child.props?.className === "ui-surface-toolbar__filters",
    ),
    "filters stay inside the shared controls wrapper",
  );

  const visibleButtons = root.findAllByType(Button);
  assert.equal(visibleButtons.length, 3, "only three actions remain visible in the toolbar chrome");
  assert.deepEqual(
    visibleButtons.map((button) => elementText(button.props.children)),
    ["Create task", "Refresh", "Pin view"],
    "visible actions render primary first and stop at the chrome budget",
  );
  assert.deepEqual(
    visibleButtons.map((button) => button.props.leadingIcon),
    ["ph:plus-bold", "ph:arrows-clockwise-bold", "ph:push-pin"],
    "visible buttons keep their icons",
  );
  assert.deepEqual(
    visibleButtons.map((button) => Boolean(button.props.disabled)),
    [false, false, true],
    "visible buttons preserve disabled state",
  );

  visibleButtons[0].props.onClick();
  visibleButtons[1].props.onClick();
  assert.deepEqual(calls, ["create", "refresh"], "visible buttons keep their callbacks");

  const overflow = root.findByType(OverflowMenu);
  assert.equal(overflow.props.ariaLabel, "More surface actions");
  const overflowItems = Children.toArray(overflow.props.children);
  assert.equal(overflowItems.length, 3, "excess visible and explicit overflow actions share one menu");
  assert.ok(
    overflowItems.every((item) => item.type === PopoverItem),
    "overflow children are shared popover items rather than ad hoc menu rows",
  );
  assert.deepEqual(
    overflowItems.map((item) => elementText(item.props.children)),
    ["View history", "Archive view", "Open settings"],
    "overflow keeps source order across explicit and budget-spilled actions",
  );
  assert.deepEqual(
    overflowItems.map((item) => item.props.icon),
    ["ph:rows", "ph:tray", "ph:gear-six-bold"],
    "overflow entries keep their icons",
  );
  assert.deepEqual(
    overflowItems.map((item) => Boolean(item.props.disabled)),
    [false, false, true],
    "overflow entries preserve disabled state",
  );

  overflowItems[0].props.onSelect();
  overflowItems[1].props.onSelect();
  assert.deepEqual(
    calls,
    ["create", "refresh", "history", "archive"],
    "overflow entries keep their original callbacks",
  );
});

test("sets aria-pressed on visible buttons when active is true and omits it when unset", async () => {
  let renderer = null;

  await act(async () => {
    renderer = create(
      createElement(SurfaceToolbar, {
        title: "Tasks",
        actions: [
          { id: "select", label: "Select", placement: "visible", active: true, onSelect() {} },
          { id: "filter", label: "Filter", placement: "visible", onSelect() {} },
        ],
      }),
    );
  });

  const buttons = renderer.root.findAllByType(Button);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props["aria-pressed"], true, "active:true sets aria-pressed=true");
  assert.equal(buttons[1].props["aria-pressed"], undefined, "active unset leaves aria-pressed absent");
});

test("omits the overflow trigger when every action fits within the visible budget", async () => {
  let renderer = null;

  await act(async () => {
    renderer = create(
      createElement(SurfaceToolbar, {
        title: "Tasks",
        actions: [
          { id: "new", label: "New task", placement: "primary", onSelect() {} },
          { id: "sort", label: "Sort", placement: "visible", onSelect() {} },
          { id: "filter", label: "Filter", placement: "visible", onSelect() {} },
        ],
      }),
    );
  });

  const root = renderer.root;
  assert.equal(root.findAllByType(Button).length, 3, "all three in-budget actions stay visible");
  assert.equal(root.findAllByType(OverflowMenu).length, 0, "no overflow trigger renders when nothing spills out");
});

// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { act, create } from "react-test-renderer";
import { expect, test } from "vitest";

import { ProjectRootWorkspaceNotice } from "@/components/project-root-workspace-notice";
import {
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
} from "@/lib/project-root-guidance";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (value && typeof value === "object" && "children" in value) {
    return textContent((value as { children: unknown }).children);
  }
  return "";
}

test("renders the canonical containment error for the server code", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      <ProjectRootWorkspaceNotice
        code={PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE}
        error="A generic creation failure"
      />,
    );
  });

  const alert = renderer.root.findByProps({ role: "alert" });
  expect(textContent(alert.children)).toBe(PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR);
  expect(alert.type).toBe("p");
  renderer.unmount();
});

test("keeps unrelated creation errors intact and supports inline spans", async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      <ProjectRootWorkspaceNotice
        as="span"
        code="OTHER_PROJECT_ERROR"
        error="The desktop is unavailable"
      />,
    );
  });

  const alert = renderer.root.findByProps({ role: "alert" });
  expect(textContent(alert.children)).toBe("The desktop is unavailable");
  expect(alert.type).toBe("span");
  renderer.unmount();
});

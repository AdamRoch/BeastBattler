// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { createTargetPreview } from "./target-preview";

describe("spell target preview", () => {
  it("draws from the selected spell to the actual target and cleans up", () => {
    const root = document.createElement("div");
    const source = document.createElement("button");
    const target = document.createElement("button");
    root.append(source, target);
    document.body.append(root);
    setRect(source, 100, 500, 120, 160);
    setRect(target, 700, 120, 140, 80);
    const preview = createTargetPreview(root);

    preview.show(source, target);

    const layer = root.querySelector<SVGElement>(".target-preview-layer");
    const path = root.querySelector<SVGPathElement>(".target-preview-path");
    expect(layer?.hasAttribute("hidden")).toBe(false);
    expect(path?.getAttribute("d")).toMatch(/^M 160 580 C /);
    expect(path?.getAttribute("d")).toContain("770 160");

    preview.hide();
    expect(layer?.hasAttribute("hidden")).toBe(true);
    expect(path?.hasAttribute("d")).toBe(false);
    preview.dispose();
    expect(root.querySelector(".target-preview-layer")).toBeNull();
  });
});

function setRect(
  element: Element,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => new DOMRect(left, top, width, height),
  });
}

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  createSpellTooltip,
  spellTooltipContent,
} from "./spell-tooltip";

describe("spell tooltip content", () => {
  it("reads the effect text from the spell catalog", () => {
    expect(spellTooltipContent("destroy")).toEqual({
      name: "Destroy",
      timingLabel: "SORCERY · COST 1",
      rulesText: "Destroy an opposing beast regardless of its health.",
    });
  });

  it("does not create a tooltip for an unknown spell", () => {
    expect(spellTooltipContent("not-a-spell")).toBeNull();
  });

  it("renders the catalog text in the hover tooltip", () => {
    const root = document.createElement("div");
    const tooltip = createSpellTooltip(root);
    const content = spellTooltipContent("bolt");
    if (!content) {
      throw new Error("Missing Bolt tooltip content");
    }

    tooltip.show(content, 20, 30);

    const tooltipElement = root.querySelector<HTMLElement>("[data-testid=spell-tooltip]");
    expect(tooltipElement?.hidden).toBe(false);
    expect(tooltipElement?.textContent).toContain(
      "Deal 2 damage to the opposing player or one of their beasts.",
    );

    tooltip.dispose();
  });
});

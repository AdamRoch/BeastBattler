import { describe, expect, it } from "vitest";

import { ASSIGNED_MONSTER_IDS, getMonsterHologramPalette } from "../models";
import {
  CARD_ART_IDS,
  createCardArtRenderer,
  createSpellCardArt,
  SPELL_CARD_IDS,
} from "./index";

describe("card art catalog", () => {
  it("covers all 25 monsters and four spells exactly once", () => {
    expect(ASSIGNED_MONSTER_IDS).toHaveLength(25);
    expect(SPELL_CARD_IDS).toHaveLength(4);
    expect(CARD_ART_IDS).toHaveLength(29);
    expect(new Set(CARD_ART_IDS).size).toBe(29);
  });

  it("has an element backdrop palette for every monster", () => {
    for (const cardId of ASSIGNED_MONSTER_IDS) {
      const palette = getMonsterHologramPalette(cardId);
      expect(palette.primary).toBeTruthy();
    }
  });

  it("requires the browser DOM for runtime portrait rendering", () => {
    expect(() => createCardArtRenderer()).toThrow(
      "Card art rendering requires a browser DOM",
    );
  });

  it("creates styled SVG image data for every spell", () => {
    for (const cardId of SPELL_CARD_IDS) {
      const image = createSpellCardArt(cardId);
      expect(image).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      expect(decodeURIComponent(image)).toContain(cardId);
    }
  });
});

import { describe, expect, it } from "vitest";

import { buildDeckPreview, deckPreviewMarkup } from "./deck-preview";

describe("deck preview", () => {
  it("derives the full Fire + Lightning preview from the card catalog", () => {
    const preview = buildDeckPreview("fire-lightning");

    expect(preview).toMatchObject({
      id: "fire-lightning",
      elementNames: ["Fire", "Lightning"],
      deckSize: 20,
    });
    expect(preview.creatures).toEqual([
      { name: "Ember Imp", attack: 2, health: 1, keyword: null },
      { name: "Cinder Wall", attack: 1, health: 2, keyword: "reach" },
      { name: "Spark Lynx", attack: 2, health: 1, keyword: null },
      { name: "Volt Bat", attack: 1, health: 2, keyword: "flying" },
    ]);
    expect(preview.spells.map((spell) => `${spell.name}: ${spell.rulesText}`)).toEqual([
      "Bolt: Deal 2 damage to any monster or player.",
      "Destroy: Destroy any creature regardless of its health.",
      "Draw: Draw 2 cards.",
      "Counterspell: Counter a monster summon or spell.",
    ]);
    expect(preview.fusions).toHaveLength(3);
    expect(preview.fusions.map((fusion) => fusion.name)).toEqual([
      "Inferno Beast",
      "Plasma Beast",
      "Thunder Beast",
    ]);
    expect(preview.roleSummary).toContain("Flying attackers: Volt Bat.");
    expect(preview.roleSummary).toContain("Reach blockers: Cinder Wall.");
  });

  it("renders rules, stats, and keywords in the tooltip markup", () => {
    const markup = deckPreviewMarkup(buildDeckPreview("fire-lightning"));

    expect(markup).toContain('id="deck-preview-fire-lightning"');
    expect(markup).toContain("20 CARDS");
    expect(markup).toContain("Volt Bat");
    expect(markup).toContain("FLYING");
    expect(markup).toContain("Destroy any creature regardless of its health.");
    expect(markup).toContain("Plasma Beast");
    expect(markup).toContain("BURST");
  });
});

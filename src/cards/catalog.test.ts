import { describe, expect, it } from "vitest";

import { createMatch, type Element, type LandCard } from "../rules/core";
import {
  ARCHETYPES,
  BASE_MONSTERS,
  CARD_CATALOG,
  FUSION_MONSTERS,
  SPELLS,
  assembleDeck,
  deriveExtraDeck,
  findSpellDefinition,
  type BaseMonsterCard,
  type SpellCardInstance,
} from "./catalog";

describe("the PRD card chart", () => {
  it("contains 29 unique named cards", () => {
    expect(CARD_CATALOG).toHaveLength(29);
    expect(new Set(CARD_CATALOG.map((card) => card.id)).size).toBe(29);
    expect(new Set(CARD_CATALOG.map((card) => card.name)).size).toBe(29);
  });

  it("matches all 10 base monsters", () => {
    expect(
      BASE_MONSTERS.map(
        ({ id, name, element, attack, health, cost, level }) => ({
          id,
          name,
          element,
          attack,
          health,
          cost,
          level,
        }),
      ),
    ).toEqual([
      base("ember-imp", "Ember Imp", "fire", 2, 1),
      base("cinder-wall", "Cinder Wall", "fire", 1, 2),
      base("tide-serpent", "Tide Serpent", "water", 1, 2),
      base("reef-guardian", "Reef Guardian", "water", 1, 3),
      base("stone-bull", "Stone Bull", "earth", 2, 2),
      base("moss-tortoise", "Moss Tortoise", "earth", 1, 3),
      base("gale-hawk", "Gale Hawk", "air", 2, 1),
      base("cloud-sprite", "Cloud Sprite", "air", 1, 2),
      base("spark-lynx", "Spark Lynx", "lightning", 2, 1),
      base("volt-bat", "Volt Bat", "lightning", 1, 2),
    ]);
  });

  it("matches all 15 fusion monsters and their keywords", () => {
    expect(
      FUSION_MONSTERS.map(
        ({ id, name, elements, attack, health, keyword, level }) => ({
          id,
          name,
          elements,
          attack,
          health,
          keyword,
          level,
        }),
      ),
    ).toEqual([
      fusion("inferno-beast", "Inferno Beast", ["fire", "fire"], 4, 2, "burst"),
      fusion("steam-beast", "Steam Beast", ["fire", "water"], 3, 3),
      fusion("magma-beast", "Magma Beast", ["fire", "earth"], 4, 3),
      fusion("wildfire-beast", "Wildfire Beast", ["fire", "air"], 4, 2),
      fusion("plasma-beast", "Plasma Beast", ["fire", "lightning"], 4, 2, "burst"),
      fusion("tsunami-beast", "Tsunami Beast", ["water", "water"], 2, 5, "slow"),
      fusion("swamp-beast", "Swamp Beast", ["water", "earth"], 2, 4),
      fusion("ice-beast", "Ice Beast", ["water", "air"], 3, 4),
      fusion("storm-beast", "Storm Beast", ["water", "lightning"], 3, 4),
      fusion("golem-beast", "Golem Beast", ["earth", "earth"], 3, 5, "slow"),
      fusion("sandstorm-beast", "Sandstorm Beast", ["earth", "air"], 3, 4),
      fusion("crystal-beast", "Crystal Beast", ["earth", "lightning"], 3, 4),
      fusion("cyclone-beast", "Cyclone Beast", ["air", "air"], 4, 3),
      fusion("thunderbird-beast", "Thunderbird Beast", ["air", "lightning"], 4, 3),
      fusion("thunder-beast", "Thunder Beast", ["lightning", "lightning"], 4, 3),
    ]);
  });

  it("matches all four spells and their effects", () => {
    expect(SPELLS).toEqual([
      {
        id: "bolt",
        category: "spell",
        kind: "spell",
        name: "Bolt",
        cost: 1,
        timing: "sorcery",
        effect: { kind: "damage", amount: 2, target: "any" },
        rulesText: "Deal 2 damage to any monster or player.",
      },
      {
        id: "destroy",
        category: "spell",
        kind: "spell",
        name: "Destroy",
        cost: 1,
        timing: "sorcery",
        effect: { kind: "destroy", target: "monster" },
        rulesText: "Destroy any creature regardless of its health.",
      },
      {
        id: "draw",
        category: "spell",
        kind: "spell",
        name: "Draw",
        cost: 1,
        timing: "sorcery",
        effect: { kind: "draw", count: 2 },
        rulesText: "Draw 2 cards.",
      },
      {
        id: "counterspell",
        category: "spell",
        kind: "spell",
        name: "Counterspell",
        cost: 1,
        timing: "instant",
        effect: { kind: "counter", target: "monster-summon-or-spell" },
        rulesText: "Counter a monster summon or spell.",
      },
    ]);
  });

  it("looks up plain-language spell effect text by spell ID", () => {
    expect(findSpellDefinition("destroy")?.rulesText).toBe(
      "Destroy any creature regardless of its health.",
    );
    expect(findSpellDefinition("not-a-spell")).toBeUndefined();
  });
});

describe("deck assembly", () => {
  it("assembles the formula for all 10 archetypes", () => {
    expect(ARCHETYPES).toHaveLength(10);

    for (const archetype of ARCHETYPES) {
      const deck = assembleDeck(archetype.id);
      const lands = deck.filter((card): card is LandCard => card.kind === "land");
      const monsters = deck.filter(
        (card): card is BaseMonsterCard => card.kind === "monster",
      );
      const spells = deck.filter(
        (card): card is SpellCardInstance => card.kind === "spell",
      );

      expect(deck, archetype.id).toHaveLength(20);
      expect(
        new Set(deck.map((card) => card.instanceId)).size,
        archetype.id,
      ).toBe(20);
      expect(lands, archetype.id).toHaveLength(8);
      expect(monsters, archetype.id).toHaveLength(8);
      expect(spells, archetype.id).toHaveLength(4);

      for (const element of archetype.elements) {
        expect(
          lands.filter((card) => card.element === element),
          `${archetype.id} ${element} lands`,
        ).toHaveLength(4);
      }

      const expectedMonsterIds = BASE_MONSTERS.filter((monster) =>
        archetype.elements.some((element) => element === monster.element),
      ).map((monster) => monster.id);
      expect(expectedMonsterIds, archetype.id).toHaveLength(4);
      for (const monsterId of expectedMonsterIds) {
        expect(
          monsters.filter((card) => card.id === monsterId),
          `${archetype.id} ${monsterId} copies`,
        ).toHaveLength(2);
      }

      for (const spell of SPELLS) {
        expect(
          spells.filter((card) => card.id === spell.id),
          `${archetype.id} ${spell.id} copies`,
        ).toHaveLength(1);
      }

      expect(
        lands.every(
          (card) => !("attack" in card) && !("health" in card) && !("cost" in card),
        ),
      ).toBe(true);
      expect(() =>
        createMatch({ playerOneDeck: deck, playerTwoDeck: deck }),
      ).not.toThrow();
    }
  });
});

describe("extra-deck derivation", () => {
  it("returns A+A, A+B, and B+B for every archetype", () => {
    for (const archetype of ARCHETYPES) {
      const [first, second] = archetype.elements;
      const extraDeck = deriveExtraDeck(archetype.id);

      expect(extraDeck, archetype.id).toHaveLength(3);
      expect(
        extraDeck.map((fusionCard) => fusionCard.elements),
        archetype.id,
      ).toEqual([
        [first, first],
        [first, second],
        [second, second],
      ]);
    }
  });

  it("derives Inferno, Steam, and Tsunami for Fire/Water", () => {
    expect(
      deriveExtraDeck("fire-water").map((card) => card.name),
    ).toEqual(["Inferno Beast", "Steam Beast", "Tsunami Beast"]);
  });
});

function base(
  id: string,
  name: string,
  element: Element,
  attack: number,
  health: number,
) {
  return { id, name, element, attack, health, cost: 1, level: 1 };
}

function fusion(
  id: string,
  name: string,
  elements: readonly [Element, Element],
  attack: number,
  health: number,
  keyword: "burst" | "slow" | null = null,
) {
  return { id, name, elements, attack, health, keyword, level: 2 };
}

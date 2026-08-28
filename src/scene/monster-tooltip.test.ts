import { describe, expect, it } from "vitest";

import { BASE_MONSTERS, FUSION_MONSTERS } from "../cards/catalog";
import type {
  BaseMonsterCard,
  FusionMonsterCard,
  MonsterPermanent,
} from "../rules/core";
import {
  monsterCardTooltipContent,
  monsterTooltipContent,
} from "./monster-tooltip";

describe("monster tooltip content", () => {
  it("shows live stats, base level, element, and ready status for a base monster", () => {
    const card: BaseMonsterCard = {
      ...baseMonster("ember-imp"),
      instanceId: "ember-imp-1",
    };

    expect(monsterTooltipContent(permanent(card, 1), false)).toEqual({
      name: "Ember Imp",
      attack: 2,
      currentHealth: 0,
      maximumHealth: 1,
      elementLabel: "Fire",
      levelLabel: "LEVEL 1 · BASE",
      statusLabel: "READY",
      rules: ["Trample: excess combat damage hits the defending player."],
    });
  });

  it("describes a damaged ★3 Burst fusion and its summoning sickness", () => {
    const card: FusionMonsterCard = {
      ...fusionMonster("inferno-beast"),
      instanceId: "inferno-beast-1",
      attack: 5,
      health: 3,
      level: 3,
    };

    expect(monsterTooltipContent(permanent(card, 2), true)).toEqual({
      name: "Inferno Beast",
      attack: 5,
      currentHealth: 1,
      maximumHealth: 3,
      elementLabel: "Fire / Fire",
      levelLabel: "★3 · FUSION",
      statusLabel: "SUMMONING SICK",
      rules: [
        "Burst: On fusion or ★3 upgrade, deal 1 damage to the opponent.",
        "Trample: excess combat damage hits the defending player.",
      ],
    });
  });

  it("includes the Slow rule for a fusion that cannot attack on entry", () => {
    const card: FusionMonsterCard = {
      ...fusionMonster("tsunami-beast"),
      instanceId: "tsunami-beast-1",
    };

    expect(monsterTooltipContent(permanent(card), true).rules).toContain(
      "Slow: Cannot attack the turn it enters play.",
    );
  });

  it("explains Flying on a base creature", () => {
    const card: BaseMonsterCard = {
      ...baseMonster("ember-imp"),
      instanceId: "volt-bat-1",
      name: "Volt Bat",
      keyword: "flying",
    };

    expect(monsterTooltipContent(permanent(card), false).rules).toContain(
      "Flying: Can be blocked only by Flying or Reach creatures.",
    );
  });

  it("describes a Flying monster while it is still in hand", () => {
    const card: BaseMonsterCard = {
      ...baseMonster("volt-bat"),
      instanceId: "volt-bat-in-hand",
    };

    expect(monsterCardTooltipContent(card, "IN HAND")).toEqual({
      name: "Volt Bat",
      attack: 1,
      currentHealth: 2,
      maximumHealth: 2,
      elementLabel: "Lightning",
      levelLabel: "LEVEL 1 · BASE",
      statusLabel: "IN HAND",
      rules: [
        "Flying: Can be blocked only by Flying or Reach creatures.",
        "Trample: excess combat damage hits the defending player.",
      ],
    });
  });

  it("describes an unplayed fusion in the extra deck", () => {
    const card: FusionMonsterCard = {
      ...fusionMonster("tsunami-beast"),
      instanceId: "tsunami-extra-deck",
    };

    expect(monsterCardTooltipContent(card, "EXTRA DECK")).toMatchObject({
      name: "Tsunami Beast",
      levelLabel: "LEVEL 2 · FUSION",
      statusLabel: "EXTRA DECK",
      rules: [
        "Slow: Cannot attack the turn it enters play.",
        "Trample: excess combat damage hits the defending player.",
        "Match two base-beast elements to summon this fusion from the extra deck.",
      ],
    });
  });

  it("explains why a used fusion cannot be summoned again", () => {
    const card: FusionMonsterCard = {
      ...fusionMonster("inferno-beast"),
      instanceId: "inferno-already-used",
    };

    expect(monsterCardTooltipContent(card, "SUMMONED").rules).toContain(
      "Already used: this fusion cannot be summoned from the extra deck again this match.",
    );
  });
});

function baseMonster(
  id: "ember-imp" | "volt-bat",
): (typeof BASE_MONSTERS)[number] {
  const card = BASE_MONSTERS.find((candidate) => candidate.id === id);
  if (!card) {
    throw new Error(`Missing ${id}`);
  }
  return card;
}

function fusionMonster(
  id: "inferno-beast" | "tsunami-beast",
): (typeof FUSION_MONSTERS)[number] {
  const card = FUSION_MONSTERS.find((candidate) => candidate.id === id);
  if (!card) {
    throw new Error(`Missing ${id}`);
  }
  return card;
}

function permanent(
  card: BaseMonsterCard | FusionMonsterCard,
  damage = 0,
): MonsterPermanent {
  return {
    card,
    damage,
    summonedOnTurn: 1,
    summoningSick: false,
  };
}

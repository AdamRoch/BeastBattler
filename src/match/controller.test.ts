import { describe, expect, it } from "vitest";

import {
  assembleDeck,
  deriveExtraDeck,
  type BaseMonsterCard,
} from "../cards/catalog";
import type { PendingStackItem } from "../rules/core";
import { createFusionUpgradeOption, responseWindowMessage } from "./controller";

describe("response window messages", () => {
  it("attributes spells, summons, and fusions to the opponent", () => {
    expect(responseWindowMessage(pendingSpell(), "ai")).toBe(
      "Your opponent has cast Bolt.",
    );
    expect(responseWindowMessage(pendingSummon(), "ai")).toBe(
      "Your opponent has summoned Stone Bull.",
    );
    expect(responseWindowMessage(pendingFusion(), "ai")).toBe(
      "Your opponent is fusing Ember Imp + Tide Serpent.",
    );
  });

  it("uses player numbers in hotseat", () => {
    expect(responseWindowMessage(pendingSpell(), "hotseat")).toBe(
      "Player 2 has cast Bolt.",
    );
    expect(responseWindowMessage(pendingSpell("player-1"), "hotseat")).toBe(
      "Player 1 has cast Bolt.",
    );
  });
});

describe("fusion upgrade prompt options", () => {
  it("keeps the consumed base and upgraded fusion identities separate", () => {
    const baseMonster = assembleDeck("fire-water").find(
      (candidate): candidate is BaseMonsterCard =>
        candidate.kind === "monster" &&
        candidate.category === "base-monster" &&
        candidate.name === "Ember Imp",
    );
    const fusion = deriveExtraDeck("fire-water").find(
      (candidate) => candidate.name === "Steam Beast",
    );
    if (!baseMonster || !fusion) {
      throw new Error("Missing fusion upgrade fixtures");
    }

    expect(createFusionUpgradeOption(fusion, baseMonster)).toEqual({
      fusionId: fusion.instanceId,
      fusionName: "Steam Beast",
      fusionPortraitId: "Steam Beast",
      baseMonsterId: baseMonster.instanceId,
      baseMonsterName: "Ember Imp",
      baseMonsterPortraitId: "Ember Imp",
    });
  });
});

function pendingSpell(controller: "player-1" | "player-2" = "player-2"): PendingStackItem {
  const card = assembleDeck("fire-water").find(
    (candidate) => candidate.kind === "spell" && candidate.id === "bolt",
  );
  if (!card || card.kind !== "spell") throw new Error("Missing Bolt fixture");
  return {
    stackId: "bolt",
    kind: "spell",
    controller,
    card,
    target: { kind: "player", playerId: "player-1" },
    targetStackId: null,
  };
}

function pendingSummon(): PendingStackItem {
  const card = assembleDeck("earth-lightning").find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.name === "Stone Bull",
  );
  if (!card) throw new Error("Missing Stone Bull fixture");
  return { stackId: "stone-bull", kind: "summon", controller: "player-2", card };
}

function pendingFusion(): PendingStackItem {
  const card = deriveExtraDeck("fire-water").find(
    (candidate) => candidate.name === "Steam Beast",
  );
  if (!card) throw new Error("Missing Steam Beast fixture");
  return {
    stackId: "steam-beast",
    kind: "fusion",
    controller: "player-2",
    card,
    parentNames: ["Ember Imp", "Tide Serpent"],
  };
}

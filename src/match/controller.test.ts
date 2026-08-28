// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import {
  assembleDeck,
  deriveExtraDeck,
  type BaseMonsterCard,
} from "../cards/catalog";
import { createArenaScene } from "../arena";
import {
  createMatch,
  getPlayer,
  type LandCard,
  type LandPermanent,
  type MatchState,
  type MonsterPermanent,
  type PendingStackItem,
  type PlayerId,
} from "../rules/core";
import {
  createFusionUpgradeOption,
  mountMatch,
  responseWindowMessage,
} from "./controller";

vi.mock("../card-art", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../card-art")>();
  return {
    ...actual,
    createCardArtRenderer: () => ({
      render: () => "data:image/png;base64,",
      dispose: () => {},
    }),
  };
});

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

describe("VS AI arena reconciliation", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it.each([
    ["Moss Tortoise", "moss-tortoise"],
    ["Stone Bull", "stone-bull"],
  ])(
    "places a resolved AI %s after clearing a retired object from its last slot",
    (name, cardId) => {
      vi.useFakeTimers();
      const root = document.createElement("div");
      document.body.append(root);
      const arena = createArenaScene(16 / 9);
      const controller = mountMatch(root, arena, {
        mode: "ai",
        initialState: aiSummonState(cardId),
      });

      vi.advanceTimersByTime(360);
      expect(controller.getState().responsePlayer).toBe("player-1");

      // This mirrors a retired animation object that has survived its rules
      // permanent and would have made the old firstOpenSlot() path silently
      // skip the resolved summon.
      arena.placeMonster(
        "retired-animation-object",
        { side: "opponent", slot: 2 },
        new THREE.Group(),
      );

      click(root, '[data-action="pass-response"]');

      const summoned = getPlayer(controller.getState(), "player-2").monsters.find(
        (monster) => monster.card.instanceId === `summon-${cardId}`,
      );
      expect(summoned?.card.name).toBe(name);
      const arenaMonster = arena.getMonster(summoned?.card.instanceId ?? "");
      expect(arenaMonster).toBeTruthy();
      expect(
        arenaMonster?.getObjectByName("summoning-sickness-indicator"),
      ).toBeTruthy();
      expect(arena.getMonster("retired-animation-object")).toBeUndefined();

      controller.dispose();
    },
  );
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

function aiSummonState(cardId: string): MatchState {
  const deck = assembleDeck("earth-lightning");
  const summonCard = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === cardId,
  );
  const stoneBull = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "stone-bull",
  );
  const sparkLynx = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "spark-lynx",
  );
  const earthLand = deck.find(
    (candidate): candidate is LandCard =>
      candidate.kind === "land" && candidate.element === "earth",
  );
  if (!summonCard || !stoneBull || !sparkLynx || !earthLand) {
    throw new Error("Missing deterministic AI summon fixtures");
  }

  const state = createMatch({
    playerOneDeck: assembleDeck("fire-water"),
    playerTwoDeck: deck,
    playerOneExtraDeck: deriveExtraDeck("fire-water"),
    playerTwoExtraDeck: deriveExtraDeck("earth-lightning"),
    firstPlayer: "player-2",
  });
  return withPlayer({ ...state, activePlayer: "player-2", phase: "main", turnNumber: 5 }, "player-2", {
    hand: [{ ...summonCard, instanceId: `summon-${cardId}` }],
    lands: [readyLand(earthLand, "earth-land-1")],
    monsters: [
      permanent(stoneBull, "ai-stone-bull"),
      permanent(sparkLynx, "ai-spark-lynx"),
    ],
    landPlayedThisTurn: true,
  });
}

function withPlayer(
  state: MatchState,
  playerId: PlayerId,
  updates: Partial<MatchState["players"][number]>,
): MatchState {
  const index = playerId === "player-1" ? 0 : 1;
  const players = [...state.players] as [MatchState["players"][0], MatchState["players"][1]];
  players[index] = { ...players[index], ...updates };
  return { ...state, players };
}

function readyLand(card: LandCard, instanceId: string): LandPermanent {
  return { card: { ...card, instanceId }, ready: true };
}

function permanent(card: BaseMonsterCard, instanceId: string): MonsterPermanent {
  return {
    card: { ...card, instanceId },
    damage: 0,
    summonedOnTurn: 1,
    summoningSick: false,
  };
}

function click(root: HTMLElement, selector: string): void {
  const button = root.querySelector<HTMLElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  button.click();
}

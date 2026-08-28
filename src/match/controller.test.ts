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
  cardKeywordMarkup,
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

  it("places the human Moss Tortoise after the AI resolves its response", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.append(root);
    const arena = createArenaScene(16 / 9);
    const controller = mountMatch(root, arena, {
      mode: "ai",
      playerOneArchetype: "fire-earth",
      initialState: humanMossTortoiseSummonState(),
    });

    click(root, '[data-card-id="summon-moss-tortoise"]');
    expect(controller.getState().responsePlayer).toBe("player-2");

    // A delayed retirement can leave a renderer-only object in the final
    // player slot while rules still permits this summon.
    arena.placeMonster(
      "retired-player-animation-object",
      { side: "player", slot: 2 },
      new THREE.Group(),
    );

    vi.advanceTimersByTime(360);

    const moss = getPlayer(controller.getState(), "player-1").monsters.find(
      (monster) => monster.card.instanceId === "summon-moss-tortoise",
    );
    expect(moss?.card.name).toBe("Moss Tortoise");
    const arenaMoss = arena.getMonster(moss?.card.instanceId ?? "");
    expect(arenaMoss?.userData.monsterId).toBe(moss?.card.instanceId);
    expect(
      arenaMoss?.getObjectByName("summoning-sickness-indicator"),
    ).toBeTruthy();
    expect(arena.getMonster("retired-player-animation-object")).toBeUndefined();

    controller.dispose();
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

describe("hand-card keywords", () => {
  it("labels Flying and Reach cards without labeling ordinary cards", () => {
    const deck = assembleDeck("fire-lightning");
    const voltBat = deck.find((card) => card.kind === "monster" && card.name === "Volt Bat");
    const cinderWall = deck.find((card) => card.kind === "monster" && card.name === "Cinder Wall");
    const emberImp = deck.find((card) => card.kind === "monster" && card.name === "Ember Imp");
    if (!voltBat || !cinderWall || !emberImp) throw new Error("Missing keyword fixtures");

    expect(cardKeywordMarkup(voltBat)).toContain("FLYING");
    expect(cardKeywordMarkup(cinderWall)).toContain("REACH");
    expect(cardKeywordMarkup(emberImp)).toBe("");
  });
});

describe("contextual tutorials", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("explains the free mulligan and exposes monster rules from the hand", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const deck = assembleDeck("fire-lightning");
    const voltBat = deck.find(
      (card): card is BaseMonsterCard =>
        card.kind === "monster" &&
        card.category === "base-monster" &&
        card.name === "Volt Bat",
    );
    if (!voltBat) throw new Error("Missing Volt Bat fixture");
    const base = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
    const state: MatchState = {
      ...base,
      players: [
        { ...base.players[0], hand: [voltBat] },
        base.players[1],
      ],
    };
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      playerOneArchetype: "fire-lightning",
      initialState: state,
    });

    expect(root.querySelector("[data-testid=mulligan-prompt]")?.textContent).toContain(
      "replace all four cards once",
    );
    const trigger = root.querySelector<HTMLElement>(
      `[data-monster-tooltip-card-id="${voltBat.instanceId}"]`,
    );
    trigger?.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 120,
      clientY: 160,
    }));

    const tooltip = root.querySelector<HTMLElement>("[data-testid=monster-tooltip]");
    expect(tooltip?.hidden).toBe(false);
    expect(tooltip?.textContent).toContain("Volt Bat");
    expect(tooltip?.textContent).toContain("IN HAND");
    expect(tooltip?.textContent).toContain(
      "Flying: Can be blocked only by Flying or Reach creatures.",
    );
    controller.dispose();
  });

  it("exposes fusion rules from the extra deck", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      playerOneArchetype: "fire-water",
    });
    const trigger = root.querySelector<HTMLElement>(
      ".extra-card[data-monster-tooltip-card-id]",
    );
    trigger?.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 160,
      clientY: 140,
    }));

    const tooltip = root.querySelector<HTMLElement>("[data-testid=monster-tooltip]");
    expect(tooltip?.hidden).toBe(false);
    expect(tooltip?.textContent).toContain("EXTRA DECK");
    expect(tooltip?.textContent).toContain(
      "Trample: excess combat damage hits the defending player.",
    );
    controller.dispose();
  });

  it("keeps the next-phase instruction visible and labels land totals", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const deck = assembleDeck("fire-water");
    const land = deck.find(
      (card): card is LandCard => card.kind === "land" && card.element === "fire",
    );
    if (!land) throw new Error("Missing Fire land fixture");
    const base = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
    const state = withPlayer(
      { ...base, activePlayer: "player-1", phase: "main", turnNumber: 2 },
      "player-1",
      {
        hand: [{ ...land, instanceId: "land-in-hand" }],
        lands: [
          readyLand(land, "ready-land-1"),
          readyLand(land, "ready-land-2"),
        ],
        landPlayedThisTurn: false,
        mulliganDecision: "kept",
      },
    );
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      initialState: state,
    });

    expect(root.querySelector("[data-testid=phase-guidance]")?.textContent).toContain(
      "play one land each turn",
    );
    expect(root.querySelector(".board-player .land-count")?.textContent).toBe(
      "2 LANDS · 2 READY",
    );
    controller.dispose();
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

function humanMossTortoiseSummonState(): MatchState {
  const deck = assembleDeck("fire-earth");
  const mossTortoise = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "moss-tortoise",
  );
  const cinderWall = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "cinder-wall",
  );
  const stoneBull = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "stone-bull",
  );
  const earthLand = deck.find(
    (candidate): candidate is LandCard =>
      candidate.kind === "land" && candidate.element === "earth",
  );
  if (!mossTortoise || !cinderWall || !stoneBull || !earthLand) {
    throw new Error("Missing deterministic human Moss Tortoise fixtures");
  }

  const state = createMatch({
    playerOneDeck: deck,
    playerTwoDeck: assembleDeck("earth-lightning"),
    playerOneExtraDeck: deriveExtraDeck("fire-earth"),
    playerTwoExtraDeck: deriveExtraDeck("earth-lightning"),
    firstPlayer: "player-1",
  });
  return withPlayer({ ...state, activePlayer: "player-1", phase: "main", turnNumber: 5 }, "player-1", {
    hand: [{ ...mossTortoise, instanceId: "summon-moss-tortoise" }],
    lands: [readyLand(earthLand, "human-earth-land-1")],
    monsters: [
      permanent(cinderWall, "human-cinder-wall"),
      permanent(stoneBull, "human-stone-bull"),
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

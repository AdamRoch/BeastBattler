import { describe, expect, it } from "vitest";

import {
  BASE_MONSTERS,
  assembleDeck,
  deriveExtraDeck,
  type ArchetypeId,
  type BaseMonsterId,
} from "../cards/catalog";
import { declareAttackers } from "./combat";
import {
  advancePhase,
  createMatch,
  getPlayer,
  keepHand,
  type BaseMonsterCard,
  type GameCard,
  type MatchState,
  type MonsterPermanent,
} from "./core";
import {
  findFusionOptions,
  fuseMonsters,
  upgradeFusion,
} from "./fusion";
import { passResponse } from "./spells";

describe("fusion prompts and creation", () => {
  it("lists valid field pairs without fusing automatically", () => {
    const fireParent = basePermanent("ember-imp", "fire-parent");
    const waterParent = basePermanent("tide-serpent", "water-parent");
    const state = mainPhaseState("fire-water", [fireParent, waterParent]);

    expect(findFusionOptions(state, "player-1")).toEqual([
      {
        parentIds: [
          fireParent.card.instanceId,
          waterParent.card.instanceId,
        ],
        fusionCardId: "fire-water:fusion:steam-beast:1",
        fusionName: "Steam Beast",
      },
    ]);
    expect(getPlayer(state, "player-1").monsters).toEqual([
      fireParent,
      waterParent,
    ]);
  });

  it("consumes both parents and the matching extra-deck card for one fusion slot", () => {
    const fireParent = basePermanent("ember-imp", "fire-parent");
    const waterParent = basePermanent("tide-serpent", "water-parent");
    const state = mainPhaseState("fire-water", [fireParent, waterParent]);

    let fused = fuseMonsters(state, "player-1", [
      fireParent.card.instanceId,
      waterParent.card.instanceId,
    ]);
    expect(getPlayer(fused, "player-1").monsters).toEqual([]);
    expect(fused.stack[0]?.kind).toBe("fusion");
    expect(fused.stack[0]).toMatchObject({
      parentNames: ["Ember Imp", "Tide Serpent"],
    });
    fused = passResponse(fused, "player-2");
    const player = getPlayer(fused, "player-1");
    const fusion = player.monsters[0];

    expect(player.monsters).toHaveLength(1);
    expect(fusion.card).toMatchObject({
      category: "fusion-monster",
      name: "Steam Beast",
      elements: ["fire", "water"],
      attack: 3,
      health: 3,
      level: 2,
    });
    expect(fusion.summoningSick).toBe(false);
    expect(player.discardPile.slice(-2).map((card) => card.instanceId)).toEqual([
      fireParent.card.instanceId,
      waterParent.card.instanceId,
    ]);
    expect(player.extraDeck.map((card) => card.name)).toEqual([
      "Inferno Beast",
      "Tsunami Beast",
    ]);
  });

  it("does not transfer Flying or Reach from base parents to a fusion", () => {
    const reachParent = basePermanent("cinder-wall", "reach-parent");
    const flyingParent = basePermanent("gale-hawk", "flying-parent");
    let state = mainPhaseState("fire-air", [reachParent, flyingParent]);

    state = fuseMonsters(state, "player-1", [
      reachParent.card.instanceId,
      flyingParent.card.instanceId,
    ]);
    state = passResponse(state, "player-2");

    expect(getPlayer(state, "player-1").monsters[0]?.card).toMatchObject({
      name: "Wildfire Beast",
      keyword: null,
    });
  });

  it("grants haste to normal fusions", () => {
    const fireParent = basePermanent("ember-imp", "fire-parent", true);
    const waterParent = basePermanent("tide-serpent", "water-parent", true);
    let state = mainPhaseState("fire-water", [fireParent, waterParent]);
    state = fuseMonsters(state, "player-1", [
      fireParent.card.instanceId,
      waterParent.card.instanceId,
    ]);
    state = passResponse(state, "player-2");
    state = advancePhase(state);
    const fusionId = getPlayer(state, "player-1").monsters[0].card.instanceId;

    expect(() =>
      declareAttackers(state, "player-1", [fusionId]),
    ).not.toThrow();
  });

  it.each([
    {
      archetype: "fire-water" as const,
      first: "tide-serpent" as const,
      second: "reef-guardian" as const,
      expected: "Tsunami Beast",
    },
    {
      archetype: "fire-earth" as const,
      first: "stone-bull" as const,
      second: "moss-tortoise" as const,
      expected: "Golem Beast",
    },
  ])("keeps $expected from attacking on its first turn", ({
    archetype,
    first,
    second,
  }) => {
    const firstParent = basePermanent(first, "slow-parent-1");
    const secondParent = basePermanent(second, "slow-parent-2");
    let state = mainPhaseState(archetype, [firstParent, secondParent]);
    state = fuseMonsters(state, "player-1", [
      firstParent.card.instanceId,
      secondParent.card.instanceId,
    ]);
    state = passResponse(state, "player-2");
    state = advancePhase(state);
    const fusionId = getPlayer(state, "player-1").monsters[0].card.instanceId;

    expect(() =>
      declareAttackers(state, "player-1", [fusionId]),
    ).toThrow("summoning sickness");
  });

  it("cannot reuse a fusion after it leaves the extra deck", () => {
    const firstFire = basePermanent("ember-imp", "fire-parent-1");
    const secondFire = basePermanent("cinder-wall", "fire-parent-2");
    let state = mainPhaseState("fire-water", [firstFire, secondFire]);
    state = fuseMonsters(state, "player-1", [
      firstFire.card.instanceId,
      secondFire.card.instanceId,
    ]);
    state = passResponse(state, "player-2");
    state = withMonsters(state, "player-1", [
      ...getPlayer(state, "player-1").monsters,
      basePermanent("ember-imp", "fire-parent-3"),
      basePermanent("cinder-wall", "fire-parent-4"),
    ]);

    expect(findFusionOptions(state, "player-1")).toEqual([]);
    expect(() =>
      fuseMonsters(state, "player-1", ["fire-parent-3", "fire-parent-4"]),
    ).toThrow("No matching fusion");
  });
});

describe("fusion keywords and level 3 upgrades", () => {
  it.each([
    {
      archetype: "fire-water" as const,
      first: "ember-imp" as const,
      second: "cinder-wall" as const,
      expected: "Inferno Beast",
    },
    {
      archetype: "fire-lightning" as const,
      first: "ember-imp" as const,
      second: "spark-lynx" as const,
      expected: "Plasma Beast",
    },
  ])("applies Burst when $expected is fused", ({ archetype, first, second }) => {
    const firstParent = basePermanent(first, "parent-1");
    const secondParent = basePermanent(second, "parent-2");
    const state = mainPhaseState(archetype, [firstParent, secondParent]);

    let fused = fuseMonsters(state, "player-1", ["parent-1", "parent-2"]);
    fused = passResponse(fused, "player-2");

    expect(getPlayer(fused, "player-2").life).toBe(9);
  });

  it("absorbs a matching base monster for +1/+1 and applies Burst again", () => {
    const firstParent = basePermanent("ember-imp", "fire-parent-1");
    const secondParent = basePermanent("cinder-wall", "fire-parent-2");
    const absorbed = basePermanent("ember-imp", "fire-absorbed");
    let state = mainPhaseState("fire-water", [
      firstParent,
      secondParent,
      absorbed,
    ]);
    state = fuseMonsters(state, "player-1", [
      firstParent.card.instanceId,
      secondParent.card.instanceId,
    ]);
    state = passResponse(state, "player-2");
    const fusionId = getPlayer(state, "player-1").monsters.find(
      (monster) => monster.card.category === "fusion-monster",
    )?.card.instanceId;
    if (!fusionId) {
      throw new Error("Expected Inferno Beast");
    }

    state = upgradeFusion(
      state,
      "player-1",
      fusionId,
      absorbed.card.instanceId,
    );
    const fusion = getPlayer(state, "player-1").monsters[0];

    expect(fusion.card).toMatchObject({
      name: "Inferno Beast",
      attack: 5,
      health: 3,
      level: 3,
    });
    expect(getPlayer(state, "player-2").life).toBe(8);
    expect(
      getPlayer(state, "player-1").discardPile.at(-1)?.instanceId,
    ).toBe(absorbed.card.instanceId);
    expect(() =>
      upgradeFusion(state, "player-1", fusionId, absorbed.card.instanceId),
    ).toThrow("already at level 3");
  });

  it("rejects an absorbed base monster that shares no fusion element", () => {
    const fireParent = basePermanent("ember-imp", "fire-parent");
    const waterParent = basePermanent("tide-serpent", "water-parent");
    const earthMonster = basePermanent("stone-bull", "earth-monster");
    let state = mainPhaseState("fire-water", [fireParent, waterParent]);
    state = fuseMonsters(state, "player-1", ["fire-parent", "water-parent"]);
    state = passResponse(state, "player-2");
    state = withMonsters(state, "player-1", [
      ...getPlayer(state, "player-1").monsters,
      earthMonster,
    ]);
    const fusionId = getPlayer(state, "player-1").monsters[0].card.instanceId;

    expect(() =>
      upgradeFusion(state, "player-1", fusionId, earthMonster.card.instanceId),
    ).toThrow("must share an element");
  });
});

describe("fusion action legality", () => {
  it("allows fusion only during the active player's main phase", () => {
    const firstParent = basePermanent("ember-imp", "parent-1");
    const secondParent = basePermanent("tide-serpent", "parent-2");
    const mainState = mainPhaseState("fire-water", [firstParent, secondParent]);
    const combatState = advancePhase(mainState);

    expect(() =>
      fuseMonsters(combatState, "player-1", ["parent-1", "parent-2"]),
    ).toThrow("only legal during the main phase");
    expect(() =>
      fuseMonsters(mainState, "player-2", ["parent-1", "parent-2"]),
    ).toThrow("Only the active player");
  });

  it("does not allow a fusion monster to be used as a fusion parent", () => {
    const firstParent = basePermanent("ember-imp", "parent-1");
    const secondParent = basePermanent("tide-serpent", "parent-2");
    let state = mainPhaseState("fire-water", [firstParent, secondParent]);
    state = fuseMonsters(state, "player-1", ["parent-1", "parent-2"]);
    state = passResponse(state, "player-2");
    const fusionId = getPlayer(state, "player-1").monsters[0].card.instanceId;
    state = withMonsters(state, "player-1", [
      ...getPlayer(state, "player-1").monsters,
      basePermanent("ember-imp", "parent-3"),
    ]);

    expect(() =>
      fuseMonsters(state, "player-1", [fusionId, "parent-3"]),
    ).toThrow("not a base monster");
  });

  it("rejects fusion monsters in a main deck", () => {
    const deck: GameCard[] = [...assembleDeck("fire-water")];
    deck[0] = deriveExtraDeck("fire-water")[0];

    expect(() =>
      createMatch({ playerOneDeck: deck, playerTwoDeck: deck }),
    ).toThrow("cannot contain fusion monsters");
  });
});

function mainPhaseState(
  archetype: ArchetypeId,
  monsters: readonly MonsterPermanent[],
): MatchState {
  const deck = assembleDeck(archetype);
  const extraDeck = deriveExtraDeck(archetype);
  let state = createMatch({
    playerOneDeck: deck,
    playerTwoDeck: deck,
    playerOneExtraDeck: extraDeck,
    playerTwoExtraDeck: extraDeck,
  });
  state = keepHand(state, "player-1");
  state = keepHand(state, "player-2");
  state = advancePhase(state);
  return withMonsters(state, "player-1", monsters);
}

function basePermanent(
  cardId: BaseMonsterId,
  instanceId: string,
  summoningSick = false,
): MonsterPermanent {
  const definition = BASE_MONSTERS.find((card) => card.id === cardId);
  if (!definition) {
    throw new Error(`Missing test card: ${cardId}`);
  }

  const card: BaseMonsterCard = { ...definition, instanceId };
  return {
    card,
    damage: 0,
    summonedOnTurn: summoningSick ? 1 : 0,
    summoningSick,
  };
}

function withMonsters(
  state: MatchState,
  playerId: "player-1" | "player-2",
  monsters: readonly MonsterPermanent[],
): MatchState {
  const index = playerId === "player-1" ? 0 : 1;
  const players: [MatchState["players"][0], MatchState["players"][1]] = [
    state.players[0],
    state.players[1],
  ];
  players[index] = { ...players[index], monsters };
  return { ...state, players };
}

import { describe, expect, it } from "vitest";

import {
  BASE_MONSTERS,
  SPELLS,
  assembleDeck,
  deriveExtraDeck,
  type BaseMonsterId,
  type SpellId,
} from "../cards/catalog";
import {
  advancePhase,
  availableMana,
  createMatch,
  getPlayer,
  keepHand,
  summonMonster,
  type BaseMonsterCard,
  type Element,
  type GameCard,
  type LandPermanent,
  type MatchState,
  type MonsterPermanent,
  type SpellCard,
} from "./core";
import { fuseMonsters } from "./fusion";
import {
  availableCounterspellResponse,
  castCounterspell,
  castSpell,
  passResponse,
} from "./spells";

describe("sorcery spells", () => {
  it("casts Bolt at a player only after the response window passes", () => {
    const bolt = spell("bolt", "bolt-card");
    let state = mainPhaseState({
      playerOneHand: [bolt],
      playerOneLands: [readyLand("fire", "p1-fire")],
    });

    state = castSpell(
      state,
      "player-1",
      bolt.instanceId,
      { kind: "player", playerId: "player-2" },
      "fire",
    );

    expect(getPlayer(state, "player-2").life).toBe(10);
    expect(state.responsePlayer).toBe("player-2");
    expect(state.stack).toHaveLength(1);
    expect(availableMana(state, "player-1").fire).toBe(0);
    expect(getPlayer(state, "player-1").hand).toEqual([]);
    expect(getPlayer(state, "player-1").discardPile).toContain(bolt);

    state = passResponse(state, "player-2");
    expect(getPlayer(state, "player-2").life).toBe(8);
    expect(state.stack).toEqual([]);
    expect(state.responsePlayer).toBeNull();
  });

  it("lets Bolt damage a monster and destroys it at lethal damage", () => {
    const bolt = spell("bolt", "bolt-card");
    const survivor = permanent("reef-guardian", "survivor");
    const victim = permanent("ember-imp", "victim");
    let state = mainPhaseState({
      playerOneHand: [bolt],
      playerOneLands: [readyLand("water", "p1-water")],
      playerTwoMonsters: [survivor, victim],
    });
    state = castSpell(
      state,
      "player-1",
      bolt.instanceId,
      { kind: "monster", playerId: "player-2", monsterId: victim.card.instanceId },
      "water",
    );
    state = passResponse(state, "player-2");

    expect(
      getPlayer(state, "player-2").monsters.map(
        (monster) => monster.card.instanceId,
      ),
    ).toEqual([survivor.card.instanceId]);
    expect(
      getPlayer(state, "player-2").discardPile.at(-1)?.instanceId,
    ).toBe(victim.card.instanceId);
  });

  it("destroys a target monster with Destroy", () => {
    const destroy = spell("destroy", "destroy-card");
    const target = permanent("reef-guardian", "target");
    let state = mainPhaseState({
      playerOneHand: [destroy],
      playerOneLands: [readyLand("fire", "p1-fire")],
      playerTwoMonsters: [target],
    });
    state = castSpell(
      state,
      "player-1",
      destroy.instanceId,
      { kind: "monster", playerId: "player-2", monsterId: target.card.instanceId },
      "fire",
    );
    state = passResponse(state, "player-2");

    expect(getPlayer(state, "player-2").monsters).toEqual([]);
    expect(getPlayer(state, "player-2").discardPile).toContain(target.card);
  });

  it.each(["bolt", "destroy"] as const)(
    "rejects a friendly beast as a %s target",
    (spellId) => {
      const card = spell(spellId, `${spellId}-card`);
      const friendly = permanent("ember-imp", "friendly-beast");
      const state = mainPhaseState({
        playerOneHand: [card],
        playerOneLands: [readyLand("fire", "p1-fire")],
        playerOneMonsters: [friendly],
      });

      expect(() => castSpell(
        state,
        "player-1",
        card.instanceId,
        {
          kind: "monster",
          playerId: "player-1",
          monsterId: friendly.card.instanceId,
        },
        "fire",
      )).toThrow("can only target");
    },
  );

  it("rejects the caster as a Bolt target", () => {
    const bolt = spell("bolt", "bolt-card");
    const state = mainPhaseState({
      playerOneHand: [bolt],
      playerOneLands: [readyLand("fire", "p1-fire")],
    });

    expect(() => castSpell(
      state,
      "player-1",
      bolt.instanceId,
      { kind: "player", playerId: "player-1" },
      "fire",
    )).toThrow("can only target the opponent");
  });

  it("draws two cards for Draw", () => {
    const draw = spell("draw", "draw-card");
    let state = mainPhaseState({
      playerOneHand: [draw],
      playerOneLands: [readyLand("water", "p1-water")],
    });
    const deckSize = getPlayer(state, "player-1").deck.length;
    state = castSpell(
      state,
      "player-1",
      draw.instanceId,
      null,
      "water",
    );
    state = passResponse(state, "player-2");

    expect(getPlayer(state, "player-1").hand).toHaveLength(2);
    expect(getPlayer(state, "player-1").deck).toHaveLength(deckSize - 2);
  });

  it("allows either deck element for spell mana but only at sorcery speed", () => {
    const bolt = spell("bolt", "bolt-card");
    const counterspell = spell("counterspell", "counter-card");
    const mainState = mainPhaseState({
      playerOneHand: [bolt, counterspell],
      playerOneLands: [readyLand("water", "p1-water")],
    });

    expect(() =>
      castSpell(
        mainState,
        "player-1",
        bolt.instanceId,
        { kind: "player", playerId: "player-2" },
        "water",
      ),
    ).not.toThrow();
    expect(() =>
      castSpell(
        mainState,
        "player-1",
        counterspell.instanceId,
        null,
        "water",
      ),
    ).toThrow("only be cast in a response window");
    expect(() =>
      castSpell(
        advancePhase(mainState),
        "player-1",
        bolt.instanceId,
        { kind: "player", playerId: "player-2" },
        "water",
      ),
    ).toThrow("own main phase");
  });
});

describe("Counterspell response windows", () => {
  it("finds a legal instant-speed response from the responding hand and mana", () => {
    const bolt = spell("bolt", "bolt-card");
    const counterspell = spell("counterspell", "counter-card");
    let state = mainPhaseState({
      playerOneHand: [bolt],
      playerTwoHand: [counterspell],
      playerOneLands: [readyLand("fire", "p1-fire")],
      playerTwoLands: [readyLand("water", "p2-water")],
    });
    state = castSpell(
      state,
      "player-1",
      bolt.instanceId,
      { kind: "player", playerId: "player-2" },
      "fire",
    );

    expect(availableCounterspellResponse(state, "player-2")).toEqual({
      card: counterspell,
      payWith: "water",
    });
  });

  it.each([
    ["has no Counterspell in hand", [], [readyLand("water", "p2-water")]],
    ["has no ready land", [spell("counterspell", "counter-card")], [spentLand("water", "p2-water")]],
  ] as const)("has no response when the player %s", (_reason, playerTwoHand, playerTwoLands) => {
    const bolt = spell("bolt", "bolt-card");
    let state = mainPhaseState({
      playerOneHand: [bolt],
      playerTwoHand,
      playerOneLands: [readyLand("fire", "p1-fire")],
      playerTwoLands,
    });
    state = castSpell(
      state,
      "player-1",
      bolt.instanceId,
      { kind: "player", playerId: "player-2" },
      "fire",
    );

    expect(availableCounterspellResponse(state, "player-2")).toBeNull();
  });

  it("counters a summon before the monster enters play while card and mana stay spent", () => {
    const summonedMonster = baseCard("ember-imp", "summoned-card");
    const counterspell = spell("counterspell", "counter-card");
    let state = mainPhaseState({
      playerOneHand: [summonedMonster],
      playerTwoHand: [counterspell],
      playerOneLands: [readyLand("fire", "p1-fire")],
      playerTwoLands: [readyLand("water", "p2-water")],
    });

    state = summonMonster(state, "player-1", summonedMonster.instanceId);
    expect(getPlayer(state, "player-1").monsters).toEqual([]);
    const summonStackId = state.stack[0].stackId;
    state = castCounterspell(
      state,
      "player-2",
      counterspell.instanceId,
      summonStackId,
      "water",
    );
    state = passResponse(state, "player-1");

    expect(getPlayer(state, "player-1").monsters).toEqual([]);
    expect(getPlayer(state, "player-1").discardPile).toContain(summonedMonster);
    expect(getPlayer(state, "player-2").discardPile).toContain(counterspell);
    expect(availableMana(state, "player-1").fire).toBe(0);
    expect(availableMana(state, "player-2").water).toBe(0);
  });

  it("counters a fusion summon before it enters or triggers Burst", () => {
    const firstParent = permanent("ember-imp", "fire-parent-1");
    const secondParent = permanent("cinder-wall", "fire-parent-2");
    const counterspell = spell("counterspell", "counter-card");
    let state = mainPhaseState({
      playerOneMonsters: [firstParent, secondParent],
      playerTwoHand: [counterspell],
      playerTwoLands: [readyLand("water", "p2-water")],
    });

    state = fuseMonsters(state, "player-1", [
      firstParent.card.instanceId,
      secondParent.card.instanceId,
    ]);
    expect(getPlayer(state, "player-1").monsters).toEqual([]);
    expect(state.stack[0]?.kind).toBe("fusion");

    state = castCounterspell(
      state,
      "player-2",
      counterspell.instanceId,
      state.stack[0].stackId,
      "water",
    );
    state = passResponse(state, "player-1");

    const player = getPlayer(state, "player-1");
    expect(player.monsters).toEqual([]);
    expect(player.discardPile.map((card) => card.instanceId)).toEqual([
      firstParent.card.instanceId,
      secondParent.card.instanceId,
      "fire-water:fusion:inferno-beast:1",
    ]);
    expect(getPlayer(state, "player-2").life).toBe(10);
  });

  it("counters a spell so its effect never happens", () => {
    const bolt = spell("bolt", "bolt-card");
    const counterspell = spell("counterspell", "counter-card");
    let state = mainPhaseState({
      playerOneHand: [bolt],
      playerTwoHand: [counterspell],
      playerOneLands: [readyLand("fire", "p1-fire")],
      playerTwoLands: [readyLand("water", "p2-water")],
    });
    state = castSpell(
      state,
      "player-1",
      bolt.instanceId,
      { kind: "player", playerId: "player-2" },
      "fire",
    );
    state = castCounterspell(
      state,
      "player-2",
      counterspell.instanceId,
      state.stack[0].stackId,
      "water",
    );
    state = passResponse(state, "player-1");

    expect(getPlayer(state, "player-2").life).toBe(10);
    expect(state.stack).toEqual([]);
  });

  it("allows Counterspell as the third item only for counter-the-counter", () => {
    const draw = spell("draw", "draw-card");
    const firstCounter = spell("counterspell", "counter-1");
    const secondCounter = spell("counterspell", "counter-2");
    const fourthCounter = spell("counterspell", "counter-3");
    let state = mainPhaseState({
      playerOneHand: [draw, secondCounter],
      playerTwoHand: [firstCounter, fourthCounter],
      playerOneLands: [
        readyLand("fire", "p1-fire-1"),
        readyLand("fire", "p1-fire-2"),
      ],
      playerTwoLands: [
        readyLand("water", "p2-water-1"),
        readyLand("water", "p2-water-2"),
      ],
    });
    const originalDeckSize = getPlayer(state, "player-1").deck.length;

    state = castSpell(state, "player-1", draw.instanceId, null, "fire");
    state = castCounterspell(
      state,
      "player-2",
      firstCounter.instanceId,
      state.stack.at(-1)?.stackId ?? "missing",
      "water",
    );
    state = castCounterspell(
      state,
      "player-1",
      secondCounter.instanceId,
      state.stack.at(-1)?.stackId ?? "missing",
      "fire",
    );

    expect(state.stack).toHaveLength(3);
    expect(() =>
      castCounterspell(
        state,
        "player-2",
        fourthCounter.instanceId,
        state.stack.at(-1)?.stackId ?? "missing",
        "water",
      ),
    ).toThrow("cannot exceed three");

    state = passResponse(state, "player-2");
    expect(getPlayer(state, "player-1").deck).toHaveLength(
      originalDeckSize - 2,
    );
    expect(getPlayer(state, "player-1").hand).toHaveLength(2);
  });

  it("requires an unused land and the current response priority", () => {
    const bolt = spell("bolt", "bolt-card");
    const counterspell = spell("counterspell", "counter-card");
    let state = mainPhaseState({
      playerOneHand: [bolt],
      playerTwoHand: [counterspell],
      playerOneLands: [readyLand("fire", "p1-fire")],
      playerTwoLands: [spentLand("water", "p2-water")],
    });
    state = castSpell(
      state,
      "player-1",
      bolt.instanceId,
      { kind: "player", playerId: "player-2" },
      "fire",
    );

    expect(() =>
      castCounterspell(
        state,
        "player-1",
        counterspell.instanceId,
        state.stack[0].stackId,
        "water",
      ),
    ).toThrow("response priority");
    expect(() =>
      castCounterspell(
        state,
        "player-2",
        counterspell.instanceId,
        state.stack[0].stackId,
        "water",
      ),
    ).toThrow("No unused water land");
  });

  it("blocks phase changes and normal actions until the response resolves", () => {
    const draw = spell("draw", "draw-card");
    let state = mainPhaseState({
      playerOneHand: [draw],
      playerOneLands: [readyLand("fire", "p1-fire")],
    });
    state = castSpell(state, "player-1", draw.instanceId, null, "fire");

    expect(() => advancePhase(state)).toThrow("response window");
    expect(() =>
      castSpell(state, "player-1", draw.instanceId, null, "fire"),
    ).toThrow("response window");
    expect(() => passResponse(state, "player-1")).toThrow(
      "does not have response priority",
    );
  });
});

interface StateOptions {
  readonly playerOneHand?: readonly GameCard[];
  readonly playerTwoHand?: readonly GameCard[];
  readonly playerOneLands?: readonly LandPermanent[];
  readonly playerTwoLands?: readonly LandPermanent[];
  readonly playerOneMonsters?: readonly MonsterPermanent[];
  readonly playerTwoMonsters?: readonly MonsterPermanent[];
}

function mainPhaseState(options: StateOptions): MatchState {
  const deck = assembleDeck("fire-water");
  let state = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
  state = keepHand(state, "player-1");
  state = keepHand(state, "player-2");

  return {
    ...state,
    players: [
      {
        ...state.players[0],
        hand: options.playerOneHand ?? [],
        lands: options.playerOneLands ?? [],
        monsters: options.playerOneMonsters ?? [],
        extraDeck: deriveExtraDeck("fire-water"),
      },
      {
        ...state.players[1],
        hand: options.playerTwoHand ?? [],
        lands: options.playerTwoLands ?? [],
        monsters: options.playerTwoMonsters ?? [],
      },
    ],
  };
}

function spell(id: SpellId, instanceId: string): SpellCard {
  const definition = SPELLS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing test spell: ${id}`);
  }
  return { ...definition, instanceId };
}

function baseCard(id: BaseMonsterId, instanceId: string): BaseMonsterCard {
  const definition = BASE_MONSTERS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing test monster: ${id}`);
  }
  return { ...definition, instanceId };
}

function permanent(id: BaseMonsterId, instanceId: string): MonsterPermanent {
  return {
    card: baseCard(id, instanceId),
    damage: 0,
    summonedOnTurn: 0,
    summoningSick: false,
  };
}

function readyLand(element: Element, instanceId: string): LandPermanent {
  return land(element, instanceId, true);
}

function spentLand(element: Element, instanceId: string): LandPermanent {
  return land(element, instanceId, false);
}

function land(
  element: Element,
  instanceId: string,
  ready: boolean,
): LandPermanent {
  return {
    card: {
      instanceId,
      name: `${element} land`,
      kind: "land",
      element,
    },
    ready,
  };
}

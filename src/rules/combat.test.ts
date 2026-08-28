import { describe, expect, it } from "vitest";

import { BASE_MONSTERS, assembleDeck } from "../cards/catalog";
import {
  advancePhase,
  createMatch,
  getPlayer,
  keepHand,
  type MatchState,
  type MonsterCard,
  type MonsterPermanent,
  type PlayerId,
} from "./core";
import {
  assignBlockers,
  canBlock,
  countLegalBlockers,
  declareAttackers,
  resolveCombat,
  type BlockAssignment,
} from "./combat";

describe("attacker declarations", () => {
  it("allows ready monsters and rejects summoning-sick monsters", () => {
    const readyAttacker = permanent("stone-bull", "attacker-ready");
    const sickAttacker = permanent("ember-imp", "attacker-sick", true);
    const state = combatState([readyAttacker, sickAttacker], []);

    expect(
      declareAttackers(state, "player-1", [readyAttacker.card.instanceId]),
    ).toMatchObject({
      attackingPlayer: "player-1",
      defendingPlayer: "player-2",
      attackerIds: [readyAttacker.card.instanceId],
    });
    expect(() =>
      declareAttackers(state, "player-1", [sickAttacker.card.instanceId]),
    ).toThrow("summoning sickness");
  });

  it("allows no attackers but rejects duplicates and non-active players", () => {
    const attacker = permanent("stone-bull", "attacker");
    const state = combatState([attacker], []);

    expect(declareAttackers(state, "player-1", []).attackerIds).toEqual([]);
    expect(() =>
      declareAttackers(state, "player-1", [
        attacker.card.instanceId,
        attacker.card.instanceId,
      ]),
    ).toThrow("cannot attack more than once");
    expect(() => declareAttackers(state, "player-2", [])).toThrow(
      "Only the active player",
    );
  });

  it("does not let a stale sickness flag strand an older human monster", () => {
    const staleAttacker = {
      ...permanent("spark-lynx", "older-human-monster", true),
      summonedOnTurn: 1,
    };
    const state = combatState([staleAttacker], []);

    expect(
      declareAttackers(state, "player-1", [staleAttacker.card.instanceId])
        .attackerIds,
    ).toEqual([staleAttacker.card.instanceId]);
  });
});

describe("blocker assignments", () => {
  it("allows a summoning-sick monster to block", () => {
    const attacker = permanent("stone-bull", "attacker");
    const sickBlocker = permanent("cinder-wall", "blocker", true);
    const state = combatState([attacker], [sickBlocker]);
    const declaration = declareAttackers(state, "player-1", [
      attacker.card.instanceId,
    ]);

    expect(
      assignBlockers(state, "player-2", declaration, [
        block(attacker, sickBlocker),
      ]).blocks,
    ).toEqual([block(attacker, sickBlocker)]);
  });

  it("enforces one blocker per attacker and one attacker per blocker", () => {
    const firstAttacker = permanent("stone-bull", "attacker-1");
    const secondAttacker = permanent("ember-imp", "attacker-2");
    const firstBlocker = permanent("cinder-wall", "blocker-1");
    const secondBlocker = permanent("reef-guardian", "blocker-2");
    const state = combatState(
      [firstAttacker, secondAttacker],
      [firstBlocker, secondBlocker],
    );
    const declaration = declareAttackers(state, "player-1", [
      firstAttacker.card.instanceId,
      secondAttacker.card.instanceId,
    ]);

    expect(() =>
      assignBlockers(state, "player-2", declaration, [
        block(firstAttacker, firstBlocker),
        block(firstAttacker, secondBlocker),
      ]),
    ).toThrow("only one blocker");
    expect(() =>
      assignBlockers(state, "player-2", declaration, [
        block(firstAttacker, firstBlocker),
        block(secondAttacker, firstBlocker),
      ]),
    ).toThrow("block only one attacker");
  });

  it("rejects a ground blocker against Flying and permits Flying or Reach", () => {
    const flyingAttacker = permanent("volt-bat", "flying-attacker");
    const groundBlocker = permanent("ember-imp", "ground-blocker");
    const flyingBlocker = permanent("gale-hawk", "flying-blocker");
    const reachBlocker = permanent("cinder-wall", "reach-blocker");
    const state = combatState(
      [flyingAttacker],
      [groundBlocker, flyingBlocker, reachBlocker],
    );
    const declaration = declareAttackers(state, "player-1", [
      flyingAttacker.card.instanceId,
    ]);

    expect(canBlock(flyingAttacker, groundBlocker)).toBe(false);
    expect(canBlock(flyingAttacker, flyingBlocker)).toBe(true);
    expect(canBlock(flyingAttacker, reachBlocker)).toBe(true);
    expect(() => assignBlockers(state, "player-2", declaration, [
      block(flyingAttacker, groundBlocker),
    ])).toThrow("cannot block a Flying attacker");
    expect(assignBlockers(state, "player-2", declaration, [
      block(flyingAttacker, flyingBlocker),
    ]).blocks).toHaveLength(1);
    expect(assignBlockers(state, "player-2", declaration, [
      block(flyingAttacker, reachBlocker),
    ]).blocks).toHaveLength(1);
  });

  it("counts only legal blockers for mixed Flying and ground attacks", () => {
    const flyingAttacker = permanent("volt-bat", "flying-attacker");
    const groundAttacker = permanent("ember-imp", "ground-attacker");
    const groundBlocker = permanent("reef-guardian", "ground-blocker");
    const reachBlocker = permanent("moss-tortoise", "reach-blocker");

    expect(countLegalBlockers(
      [groundAttacker, flyingAttacker],
      [groundBlocker, reachBlocker],
    )).toBe(2);
    expect(countLegalBlockers([flyingAttacker], [groundBlocker])).toBe(0);
  });
});

describe("combat damage", () => {
  it("deals every unblocked attacker's ATK to the defending player", () => {
    const firstAttacker = permanent("stone-bull", "attacker-1");
    const secondAttacker = permanent("ember-imp", "attacker-2");
    const state = combatState([firstAttacker, secondAttacker], []);
    const declaration = declareAttackers(state, "player-1", [
      firstAttacker.card.instanceId,
      secondAttacker.card.instanceId,
    ]);
    const plan = assignBlockers(state, "player-2", declaration, []);

    const resolved = resolveCombat(state, plan);

    expect(getPlayer(resolved, "player-2").life).toBe(6);
    expect(resolved.phase).toBe("end");
  });

  it("applies universal trample, retaliation, and simultaneous deaths", () => {
    const attacker = permanent("stone-bull", "attacker");
    const blocker = permanent("ember-imp", "blocker");
    const state = combatState([attacker], [blocker]);
    const declaration = declareAttackers(state, "player-1", [
      attacker.card.instanceId,
    ]);
    const plan = assignBlockers(state, "player-2", declaration, [
      block(attacker, blocker),
    ]);

    const resolved = resolveCombat(state, plan);

    expect(getPlayer(resolved, "player-2").life).toBe(9);
    expect(getPlayer(resolved, "player-1").monsters).toEqual([]);
    expect(getPlayer(resolved, "player-2").monsters).toEqual([]);
    expect(
      getPlayer(resolved, "player-1").discardPile.at(-1)?.instanceId,
    ).toBe(attacker.card.instanceId);
    expect(
      getPlayer(resolved, "player-2").discardPile.at(-1)?.instanceId,
    ).toBe(blocker.card.instanceId);
  });

  it("keeps survivor damage until end of turn, then clears it", () => {
    const attacker = permanent("cinder-wall", "attacker");
    const blocker = permanent("cloud-sprite", "blocker");
    const state = combatState([attacker], [blocker]);
    const declaration = declareAttackers(state, "player-1", [
      attacker.card.instanceId,
    ]);
    const plan = assignBlockers(state, "player-2", declaration, [
      block(attacker, blocker),
    ]);

    let resolved = resolveCombat(state, plan);

    expect(getPlayer(resolved, "player-1").monsters[0]?.damage).toBe(1);
    expect(getPlayer(resolved, "player-2").monsters[0]?.damage).toBe(1);

    resolved = advancePhase(resolved);
    expect(getPlayer(resolved, "player-1").monsters[0]?.damage).toBe(0);
    expect(getPlayer(resolved, "player-2").monsters[0]?.damage).toBe(0);
  });

  it("ends the match when combat damage reduces the defender to zero", () => {
    const attacker = permanent("stone-bull", "attacker");
    let state = combatState([attacker], []);
    state = setPlayerLife(state, "player-2", 2);
    const declaration = declareAttackers(state, "player-1", [
      attacker.card.instanceId,
    ]);
    const plan = assignBlockers(state, "player-2", declaration, []);

    const resolved = resolveCombat(state, plan);

    expect(resolved.result).toEqual({
      winner: "player-1",
      loser: "player-2",
      reason: "life",
    });
  });

  it("cannot replay a combat plan after it has resolved", () => {
    const attacker = permanent("stone-bull", "attacker");
    const state = combatState([attacker], []);
    const declaration = declareAttackers(state, "player-1", [
      attacker.card.instanceId,
    ]);
    const plan = assignBlockers(state, "player-2", declaration, []);
    const resolved = resolveCombat(state, plan);

    expect(() => resolveCombat(resolved, plan)).toThrow(
      "only legal during the combat phase",
    );
  });
});

function combatState(
  attackers: readonly MonsterPermanent[],
  blockers: readonly MonsterPermanent[],
): MatchState {
  const deck = assembleDeck("fire-water");
  let state = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
  state = keepHand(state, "player-1");
  state = keepHand(state, "player-2");
  state = advancePhase(state);
  state = advancePhase(state);

  return {
    ...state,
    turnNumber: 3,
    players: [
      { ...state.players[0], monsters: attackers },
      { ...state.players[1], monsters: blockers },
    ],
  };
}

function permanent(
  cardId: (typeof BASE_MONSTERS)[number]["id"],
  instanceId: string,
  summoningSick = false,
): MonsterPermanent {
  const definition = BASE_MONSTERS.find((card) => card.id === cardId);
  if (!definition) {
    throw new Error(`Missing test card: ${cardId}`);
  }

  const card: MonsterCard = { ...definition, instanceId };
  return {
    card,
    damage: 0,
    summonedOnTurn: summoningSick ? 3 : 1,
    summoningSick,
  };
}

function block(
  attacker: MonsterPermanent,
  blocker: MonsterPermanent,
): BlockAssignment {
  return {
    attackerId: attacker.card.instanceId,
    blockerId: blocker.card.instanceId,
  };
}

function setPlayerLife(
  state: MatchState,
  playerId: PlayerId,
  life: number,
): MatchState {
  const index = playerId === "player-1" ? 0 : 1;
  const players: [MatchState["players"][0], MatchState["players"][1]] = [
    state.players[0],
    state.players[1],
  ];
  players[index] = { ...players[index], life };
  return { ...state, players };
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { BASE_MONSTERS, FUSION_MONSTERS, assembleDeck } from "../cards/catalog";
import { createMatch, type MatchState, type MonsterCard, type MonsterPermanent } from "../rules/core";
import { assignBlockers, declareAttackers } from "../rules/combat";
import {
  buildCombatPresentation,
  CombatPresentationQueue,
} from "./combat-presentation";

describe("combat presentation", () => {
  afterEach(() => vi.useRealTimers());

  it("reports each matchup and trample in plan order", () => {
    const first = permanent("stone-bull", "attacker-1");
    const second = permanent("ember-imp", "attacker-2");
    const firstBlocker = permanent("cinder-wall", "blocker-1");
    const secondBlocker = permanent("moss-tortoise", "blocker-2");
    const state = combatState([first, second], [firstBlocker, secondBlocker]);
    const declaration = declareAttackers(state, "player-1", ["attacker-2", "attacker-1"]);
    const plan = assignBlockers(state, "player-2", declaration, [
      { attackerId: "attacker-2", blockerId: "blocker-2" },
      { attackerId: "attacker-1", blockerId: "blocker-1" },
    ]);

    const beats = buildCombatPresentation(state, plan, "player-1");

    expect(beats.map((beat) => `${beat.kind}:${beat.matchup}`)).toEqual([
      "engage:Ember Imp → Moss Tortoise",
      "impact:Ember Imp → Moss Tortoise",
      "engage:Stone Bull → Cinder Wall",
      "impact:Stone Bull → Cinder Wall",
    ]);
    expect(beats[1]?.messages).toEqual([
      "Moss Tortoise took 2 damage.",
      "Ember Imp took 1 damage.",
    ]);
    expect(beats[3]?.messages).toEqual([
      "Cinder Wall took 2 damage.",
      "Stone Bull took 1 damage.",
    ]);
  });

  it("keeps each beat visible until its timer and cancels cleanly", () => {
    vi.useFakeTimers();
    const attacker = permanent("inferno-beast", "attacker");
    const blocker = permanent("cinder-wall", "blocker");
    const state = combatState([attacker], [blocker]);
    const plan = assignBlockers(
      state,
      "player-2",
      declareAttackers(state, "player-1", ["attacker"]),
      [{ attackerId: "attacker", blockerId: "blocker" }],
    );
    const beats = buildCombatPresentation(state, plan, "player-1");
    const seen: string[] = [];
    let complete = false;
    const queue = new CombatPresentationQueue(window);

    queue.play(beats, (beat) => seen.push(beat.kind), () => complete = true);
    expect(seen).toEqual(["engage"]);
    vi.advanceTimersByTime(beats[0]?.durationMs ?? 0);
    expect(seen).toEqual(["engage", "impact"]);
    expect(beats[1]?.messages).toContain("2 trample damage hit your opponent.");
    queue.clear();
    vi.runAllTimers();
    expect(complete).toBe(false);
  });
});

function combatState(
  attackers: readonly MonsterPermanent[],
  blockers: readonly MonsterPermanent[],
): MatchState {
  const deck = assembleDeck("fire-water");
  const state = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
  return {
    ...state,
    activePlayer: "player-1",
    phase: "combat",
    turnNumber: 3,
    players: [
      { ...state.players[0], monsters: attackers, mulliganDecision: "kept" },
      { ...state.players[1], monsters: blockers, mulliganDecision: "kept" },
    ],
  };
}

function permanent(
  cardId: (typeof BASE_MONSTERS)[number]["id"] | (typeof FUSION_MONSTERS)[number]["id"],
  instanceId: string,
): MonsterPermanent {
  const definition = [...BASE_MONSTERS, ...FUSION_MONSTERS].find((card) => card.id === cardId);
  if (!definition) throw new Error(`Missing ${cardId}`);
  return {
    card: { ...definition, instanceId } as MonsterCard,
    damage: 0,
    summonedOnTurn: 1,
    summoningSick: false,
  };
}

import { describe, expect, it } from "vitest";

import { assembleDeck } from "../cards/catalog";
import {
  createMatch,
  type BaseMonsterCard,
  type FusionMonsterCard,
  type MatchState,
  type MonsterPermanent,
} from "../rules/core";
import { boardZoneMarkup } from "./board-zone";

describe("HUD board-zone projection", () => {
  it("shows the empty state only while the live player state has no monsters", () => {
    const empty = matchState();

    expect(boardZoneMarkup(empty, "player-1")).toContain(
      'data-testid="player-1-board-empty"',
    );

    const summoned = withPlayerOneMonsters(empty, [baseMonster()]);
    const summonedMarkup = boardZoneMarkup(summoned, "player-1");

    expect(summonedMarkup).toContain('data-monster-id="summoned-monster"');
    expect(summonedMarkup).toContain("Ember Imp");
    expect(summonedMarkup).not.toContain("No monsters deployed");
  });

  it("re-evaluates the empty state through fusion and death snapshots", () => {
    const summoned = withPlayerOneMonsters(matchState(), [baseMonster()]);
    const fused = withPlayerOneMonsters(summoned, [fusionMonster()]);
    const dead = withPlayerOneMonsters(fused, []);

    expect(boardZoneMarkup(summoned, "player-1")).not.toContain(
      "No monsters deployed",
    );
    expect(boardZoneMarkup(fused, "player-1")).toContain("Inferno Beast");
    expect(boardZoneMarkup(fused, "player-1")).not.toContain(
      "No monsters deployed",
    );
    expect(boardZoneMarkup(dead, "player-1")).toContain(
      "No monsters deployed",
    );
  });

  it("reads the requested player's slice", () => {
    const state = withPlayerOneMonsters(matchState(), [baseMonster()]);

    expect(boardZoneMarkup(state, "player-1")).toContain("Ember Imp");
    expect(boardZoneMarkup(state, "player-2")).toContain(
      'data-testid="player-2-board-empty"',
    );
  });

  it("does not claim the board is empty while visible parents await fusion", () => {
    const state = matchState();
    const markup = boardZoneMarkup(state, "player-1", {
      fusionPending: true,
    });

    expect(markup).toContain("Fusion pending");
    expect(markup).not.toContain("No monsters deployed");
  });

  it("renders an older human monster ready even if its stored flag is stale", () => {
    const oldMonster: MonsterPermanent = {
      ...baseMonster(),
      summonedOnTurn: 9,
      summoningSick: true,
    };
    const state = withPlayerOneMonsters(
      { ...matchState(), turnNumber: 13 },
      [oldMonster],
    );
    const markup = boardZoneMarkup(state, "player-1");

    expect(markup).toContain("READY");
    expect(markup).not.toContain("SICK");
  });
});

function matchState(): MatchState {
  const deck = assembleDeck("fire-water");
  return createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
}

function withPlayerOneMonsters(
  state: MatchState,
  monsters: readonly MonsterPermanent[],
): MatchState {
  return {
    ...state,
    players: [
      { ...state.players[0], monsters },
      state.players[1],
    ],
  };
}

function baseMonster(): MonsterPermanent {
  const card: BaseMonsterCard = {
    instanceId: "summoned-monster",
    name: "Ember Imp",
    kind: "monster",
    category: "base-monster",
    element: "fire",
    attack: 2,
    health: 1,
    level: 1,
  };
  return permanent(card);
}

function fusionMonster(): MonsterPermanent {
  const card: FusionMonsterCard = {
    instanceId: "fused-monster",
    name: "Inferno Beast",
    kind: "monster",
    category: "fusion-monster",
    elements: ["fire", "fire"],
    attack: 4,
    health: 2,
    level: 2,
    keyword: "burst",
  };
  return permanent(card);
}

function permanent(
  card: BaseMonsterCard | FusionMonsterCard,
): MonsterPermanent {
  return {
    card,
    damage: 0,
    summonedOnTurn: 1,
    summoningSick: false,
  };
}

import { describe, expect, it } from "vitest";

import { assembleDeck } from "../cards/catalog";
import { createMatch, type MatchState } from "../rules/core";
import { createCoachMarkTracker } from "./coach-marks";

describe("tutorial coach marks", () => {
  it("points out a matching land and base monster during the local main phase", () => {
    const [land, monster] = matchingLandAndMonster();
    const tracker = createCoachMarkTracker();
    const state = withPlayer(matchState(), "player-1", {
      hand: [land, monster],
    });

    expect(tracker.update(mainPhase(state), "player-1")).toMatchObject({
      kind: "land-monster-pairing",
      cardIds: [land.instanceId, monster.instanceId],
    });
  });

  it("waits until a sorcery has its legal timing, mana, and target", () => {
    const spell = findSpell("bolt");
    const land = findFireLand();
    const tracker = createCoachMarkTracker();
    const base = withPlayer(matchState(), "player-1", {
      hand: [spell],
      lands: [{ card: land, ready: true }],
    });

    expect(tracker.update(base, "player-1")).toBeNull();
    expect(tracker.update(mainPhase(base), "player-1")).toMatchObject({
      kind: "sorcery-timing",
      cardIds: [spell.instanceId],
    });
  });

  it("offers the land tip only when turn two starts in the local main phase", () => {
    const land = findFireLand();
    const tracker = createCoachMarkTracker();
    const drawPhase = withPlayer(matchState(), "player-1", {
      hand: [land],
    });
    const turnTwoMain = {
      ...drawPhase,
      phase: "main" as const,
      turnNumber: 2,
    };

    expect(tracker.update(drawPhase, "player-1")).toBeNull();
    expect(tracker.update(turnTwoMain, "player-1")).toMatchObject({
      kind: "play-a-land",
      cardIds: [land.instanceId],
    });
  });

  it("shows each coach mark once, even after dismissal", () => {
    const [land, monster] = matchingLandAndMonster();
    const tracker = createCoachMarkTracker();
    const state = withPlayer(matchState(), "player-1", {
      hand: [land, monster],
    });

    expect(tracker.update(mainPhase(state), "player-1")).not.toBeNull();
    expect(tracker.dismissForCard(land.instanceId)).toBe(true);
    expect(tracker.update(mainPhase(state), "player-1")).toBeNull();
  });
});

function matchState(): MatchState {
  const deck = assembleDeck("fire-water");
  return createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
}

function mainPhase(state: MatchState): MatchState {
  return { ...state, phase: "main", turnNumber: 1 };
}

function withPlayer(
  state: MatchState,
  playerId: "player-1" | "player-2",
  updates: Partial<MatchState["players"][number]>,
): MatchState {
  const [playerOne, playerTwo] = state.players;
  return {
    ...state,
    players: [
      playerOne.id === playerId ? { ...playerOne, ...updates } : playerOne,
      playerTwo.id === playerId ? { ...playerTwo, ...updates } : playerTwo,
    ],
  };
}

function matchingLandAndMonster() {
  return [findFireLand(), findFireMonster()] as const;
}

function findFireLand() {
  const card = assembleDeck("fire-water").find(
    (candidate) => candidate.kind === "land" && candidate.element === "fire",
  );
  if (!card || card.kind !== "land") {
    throw new Error("Missing Fire Land");
  }
  return card;
}

function findFireMonster() {
  const card = assembleDeck("fire-water").find(
    (candidate) => candidate.kind === "monster" && candidate.element === "fire",
  );
  if (!card || card.kind !== "monster" || card.category !== "base-monster") {
    throw new Error("Missing Fire monster");
  }
  return card;
}

function findSpell(id: "bolt" | "destroy" | "draw" | "counterspell") {
  const card = assembleDeck("fire-water").find(
    (candidate) => candidate.kind === "spell" && candidate.id === id,
  );
  if (!card) {
    throw new Error(`Missing ${id}`);
  }
  return card;
}

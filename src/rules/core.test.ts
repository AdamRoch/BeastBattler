import { describe, expect, it } from "vitest";

import {
  advancePhase,
  availableMana,
  createMatch,
  dealPlayerDamage,
  discardToHandLimit,
  drawCards,
  getPlayer,
  hasSummoningSickness,
  keepHand,
  playLand,
  summonMonster,
  takeMulligan,
  type GameCard,
  type LandCard,
  type BaseMonsterCard,
  type PlayerId,
} from "./core";
import { passResponse } from "./spells";

function land(instanceId: string, element: LandCard["element"]): LandCard {
  return { instanceId, name: `${element} land`, kind: "land", element };
}

function monster(
  instanceId: string,
  element: BaseMonsterCard["element"],
): BaseMonsterCard {
  return {
    instanceId,
    name: `${element} beast`,
    kind: "monster",
    category: "base-monster",
    element,
    attack: 2,
    health: 2,
    level: 1,
    keyword: null,
  };
}

function makeDeck(prefix: string, topCards: readonly GameCard[] = []): GameCard[] {
  const filler = Array.from(
    { length: 20 - topCards.length },
    (_, index): GameCard => ({
      instanceId: `${prefix}-filler-${index}`,
      name: "Test spell",
      kind: "spell",
      category: "spell",
      id: "draw",
      cost: 1,
      timing: "sorcery",
      effect: { kind: "draw", count: 2 },
    }),
  );

  return [...topCards, ...filler];
}

function startMatch(
  playerOneDeck = makeDeck("p1"),
  playerTwoDeck = makeDeck("p2"),
) {
  let state = createMatch({ playerOneDeck, playerTwoDeck });
  state = keepHand(state, "player-1");
  return keepHand(state, "player-2");
}

function passTurn(state: ReturnType<typeof startMatch>) {
  let nextState = state;
  while (nextState.phase !== "end") {
    nextState = advancePhase(nextState);
  }
  return advancePhase(nextState);
}

describe("match setup and turn flow", () => {
  it("supports one free mulligan before starting with four cards", () => {
    const originalDeck = makeDeck("p1");
    let state = createMatch({
      playerOneDeck: originalDeck,
      playerTwoDeck: makeDeck("p2"),
    });
    const originalHandIds = getPlayer(state, "player-1").hand.map(
      (card) => card.instanceId,
    );
    const shuffledDeck = [...originalDeck.slice(4), ...originalDeck.slice(0, 4)];

    state = takeMulligan(state, "player-1", shuffledDeck);

    expect(getPlayer(state, "player-1").hand).toHaveLength(4);
    expect(getPlayer(state, "player-1").hand.map((card) => card.instanceId)).not
      .toEqual(originalHandIds);
    expect(() => takeMulligan(state, "player-1", originalDeck)).toThrow(
      "only one mulligan decision",
    );

    state = keepHand(state, "player-2");
    expect(state.phase).toBe("draw");
    expect(state.turnNumber).toBe(1);
  });

  it("follows draw, main, combat, end with no second main phase", () => {
    let state = startMatch();

    expect(state.activePlayer).toBe("player-1");
    expect(state.phase).toBe("draw");
    expect(getPlayer(state, "player-1").hand).toHaveLength(4);

    state = advancePhase(state);
    expect(state.phase).toBe("main");
    state = advancePhase(state);
    expect(state.phase).toBe("combat");
    state = advancePhase(state);
    expect(state.phase).toBe("end");
    state = advancePhase(state);

    expect(state.activePlayer).toBe("player-2");
    expect(state.phase).toBe("draw");
    expect(state.turnNumber).toBe(2);
    expect(getPlayer(state, "player-2").hand).toHaveLength(5);
  });

  it("clears a human monster's sickness when its next turn begins", () => {
    const fireLand = land("human-fire-land", "fire");
    const fireMonster = monster("human-monster", "fire");
    let state = startMatch(makeDeck("p1", [fireLand, fireMonster]));

    state = advancePhase(state);
    state = playLand(state, "player-1", fireLand.instanceId);
    state = summonMonster(state, "player-1", fireMonster.instanceId);
    state = passResponse(state, "player-2");

    expect(
      hasSummoningSickness(
        state,
        getPlayer(state, "player-1").monsters[0],
      ),
    ).toBe(true);

    state = passTurn(state);
    expect(state.activePlayer).toBe("player-2");
    state = passTurn(state);

    const monsterOnNextTurn = getPlayer(state, "player-1").monsters[0];
    expect(state).toMatchObject({
      activePlayer: "player-1",
      phase: "draw",
      turnNumber: 3,
    });
    expect(monsterOnNextTurn.summoningSick).toBe(false);
    expect(hasSummoningSickness(state, monsterOnNextTurn)).toBe(false);
  });
});

describe("lands and mana", () => {
  it("requires mana that matches the monster's element", () => {
    const fireLand = land("fire-land", "fire");
    const waterMonster = monster("water-monster", "water");
    let state = startMatch(
      makeDeck("p1", [fireLand, waterMonster]),
    );
    state = advancePhase(state);
    state = playLand(state, "player-1", fireLand.instanceId);

    expect(availableMana(state, "player-1")).toMatchObject({
      fire: 1,
      water: 0,
    });
    expect(() =>
      summonMonster(state, "player-1", waterMonster.instanceId),
    ).toThrow("No water mana");
  });

  it("limits land plays, spends typed mana, and allows multiple summons", () => {
    const fireLandOne = land("fire-land-1", "fire");
    const fireLandTwo = land("fire-land-2", "fire");
    const firstMonster = monster("monster-1", "fire");
    const secondMonster = monster("monster-2", "fire");
    const thirdMonster = monster("monster-3", "fire");
    let state = startMatch(
      makeDeck("p1", [
        fireLandOne,
        fireLandTwo,
        firstMonster,
        secondMonster,
        thirdMonster,
      ]),
    );
    state = advancePhase(state);
    state = playLand(state, "player-1", fireLandOne.instanceId);

    expect(availableMana(state, "player-1").fire).toBe(1);
    expect(() => playLand(state, "player-1", fireLandTwo.instanceId)).toThrow(
      "only one land",
    );

    const beforeSummon = state;
    state = summonMonster(state, "player-1", firstMonster.instanceId);
    expect(availableMana(state, "player-1").fire).toBe(0);
    expect(beforeSummon).not.toBe(state);
    expect(getPlayer(beforeSummon, "player-1").hand).toContain(firstMonster);
    state = passResponse(state, "player-2");
    expect(() => summonMonster(state, "player-1", secondMonster.instanceId)).toThrow(
      "No fire mana",
    );

    state = passTurn(state);
    state = passTurn(state);
    state = advancePhase(state);

    expect(availableMana(state, "player-1").fire).toBe(1);
    state = playLand(state, "player-1", fireLandTwo.instanceId);
    state = summonMonster(state, "player-1", secondMonster.instanceId);
    state = passResponse(state, "player-2");
    state = summonMonster(state, "player-1", thirdMonster.instanceId);
    state = passResponse(state, "player-2");

    expect(getPlayer(state, "player-1").monsters).toHaveLength(3);
    expect(availableMana(state, "player-1").fire).toBe(0);
  });
});

describe("hand limits", () => {
  it("requires the active player to discard down to seven at end of turn", () => {
    let state = startMatch();
    state = drawCards(state, "player-1", 4);
    state = advancePhase(state);
    state = advancePhase(state);
    state = advancePhase(state);

    expect(getPlayer(state, "player-1").hand).toHaveLength(8);
    expect(() => advancePhase(state)).toThrow("Discard down to seven");

    const cardToDiscard = getPlayer(state, "player-1").hand[0];
    state = discardToHandLimit(state, "player-1", [cardToDiscard.instanceId]);
    state = advancePhase(state);

    expect(getPlayer(state, "player-1").hand).toHaveLength(7);
    expect(getPlayer(state, "player-1").discardPile).toContain(cardToDiscard);
    expect(state.activePlayer).toBe("player-2");
  });
});

describe("life and match results", () => {
  it("starts players at 10 life and awards a win at zero", () => {
    let state = startMatch();

    expect(getPlayer(state, "player-1").life).toBe(10);
    expect(getPlayer(state, "player-2").life).toBe(10);

    state = dealPlayerDamage(state, "player-2", 3);
    expect(getPlayer(state, "player-2").life).toBe(7);
    expect(state.result).toBeNull();

    state = dealPlayerDamage(state, "player-2", 7);
    expect(getPlayer(state, "player-2").life).toBe(0);
    expect(state.result).toEqual({
      winner: "player-1",
      loser: "player-2",
      reason: "life",
    });
  });

  it("makes a player lose when they must draw from an empty deck", () => {
    let state = startMatch();
    state = drawCards(state, "player-1", 16);

    expect(getPlayer(state, "player-1").deck).toHaveLength(0);
    expect(state.result).toBeNull();

    state = drawCards(state, "player-1", 1);
    expect(state.result).toEqual({
      winner: "player-2",
      loser: "player-1",
      reason: "deck-out",
    });
  });

  it.each<[PlayerId, PlayerId]>([
    ["player-1", "player-2"],
    ["player-2", "player-1"],
  ])("reports %s as the loser and %s as the winner", (loser, winner) => {
    const state = dealPlayerDamage(startMatch(), loser, 10);
    expect(state.result?.winner).toBe(winner);
  });
});

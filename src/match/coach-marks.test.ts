// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { assembleDeck } from "../cards/catalog";
import { createMatch, type MatchState } from "../rules/core";
import {
  applyCoachMarkTargets,
  coachMarkMarkup,
  createCoachMarkTracker,
} from "./coach-marks";

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

  it("queues the beast tip after the sorcery tip when a matching ready land can pay for it", () => {
    const spell = findSpell("bolt");
    const land = findFireLand();
    const monster = findFireMonster();
    const tracker = createCoachMarkTracker();
    const state = withPlayer(mainPhase(matchState()), "player-1", {
      hand: [spell, monster],
      lands: [{ card: land, ready: true }],
      landPlayedThisTurn: true,
    });

    expect(tracker.update(state, "player-1")).toMatchObject({
      kind: "sorcery-timing",
    });
    tracker.dismiss();
    expect(tracker.update(state, "player-1")).toMatchObject({
      kind: "play-a-beast",
      message: "Consider playing a beast.",
      cardIds: [monster.instanceId],
    });
  });

  it("does not offer the beast tip after a base monster was summoned and later left play", () => {
    const land = findFireLand();
    const monster = findFireMonster();
    const summonedState = withPlayer(mainPhase(matchState()), "player-1", {
      hand: [],
      lands: [{ card: land, ready: true }],
      monsters: [{
        card: monster,
        damage: 0,
        summonedOnTurn: 1,
        summoningSick: true,
      }],
      landPlayedThisTurn: true,
    });
    const laterState = withPlayer(summonedState, "player-1", {
      hand: [{ ...monster, instanceId: "later-fire-monster" }],
      monsters: [],
    });
    const tracker = createCoachMarkTracker();

    expect(tracker.update(summonedState, "player-1")).toBeNull();
    expect(tracker.update(laterState, "player-1")).toBeNull();
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

  it("explains combat once when the local player has a ready attacker", () => {
    const monster = findFireMonster();
    const tracker = createCoachMarkTracker();
    const state = withPlayer(
      {
        ...matchState(),
        activePlayer: "player-1",
        phase: "combat",
        turnNumber: 2,
      },
      "player-1",
      {
        monsters: [{
          card: monster,
          damage: 0,
          summonedOnTurn: 1,
          summoningSick: false,
        }],
      },
    );

    expect(tracker.update(state, "player-1")).toMatchObject({
      kind: "combat-basics",
      message:
        "Choose your attackers. Extra ATK beyond a blocker's remaining HP hits the opponent.",
      cardIds: [],
    });
    tracker.dismiss();
    expect(tracker.update(state, "player-1")).toBeNull();
    tracker.reset();
    expect(tracker.update(state, "player-1")).toMatchObject({
      kind: "combat-basics",
    });
  });

  it("waits to explain combat until a monster can attack", () => {
    const monster = findFireMonster();
    const tracker = createCoachMarkTracker();
    const state = withPlayer(
      {
        ...matchState(),
        activePlayer: "player-1",
        phase: "combat",
        turnNumber: 1,
      },
      "player-1",
      {
        monsters: [{
          card: monster,
          damage: 0,
          summonedOnTurn: 1,
          summoningSick: true,
        }],
      },
    );

    expect(tracker.update(state, "player-1")).toBeNull();
  });
});

describe("coach-mark targets", () => {
  it("resolves both hand-card instance IDs and draws an arrow to each card", () => {
    const [land, monster] = matchingLandAndMonster();
    const root = document.createElement("div");
    const mark = {
      kind: "land-monster-pairing" as const,
      message: "This land summons this beast.",
      cardIds: [land.instanceId, monster.instanceId],
    };
    root.innerHTML = `
      <button class="hand-card" data-card-id="other-card"></button>
      <button class="hand-card" data-card-id="${land.instanceId}"></button>
      <button class="hand-card" data-card-id="${monster.instanceId}"></button>
      ${coachMarkMarkup(mark)}
    `;
    setRect(root, 0, 0, 1_000, 700);
    setRect(root.querySelector(".coach-mark")!, 400, 260, 200, 64);
    setRect(root.querySelector(`[data-card-id="${land.instanceId}"]`)!, 280, 500, 126, 176);
    setRect(root.querySelector(`[data-card-id="${monster.instanceId}"]`)!, 594, 500, 126, 176);

    applyCoachMarkTargets(root, mark);

    expect(
      root.querySelector(`[data-card-id="${land.instanceId}"]`)?.classList.contains(
        "is-coach-mark-target",
      ),
    ).toBe(true);
    expect(
      root.querySelector(`[data-card-id="${monster.instanceId}"]`)?.classList.contains(
        "is-coach-mark-target",
      ),
    ).toBe(true);
    expect(
      root.querySelector(`[data-card-id="other-card"]`)?.classList.contains(
        "is-coach-mark-target",
      ),
    ).toBe(false);
    expect(
      [...root.querySelectorAll("[data-coach-mark-target-id]")].map(
        (pointer) => pointer.getAttribute("data-coach-mark-target-id"),
      ),
    ).toEqual([land.instanceId, monster.instanceId]);
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

function setRect(
  element: Element,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => new DOMRect(left, top, width, height),
  });
}

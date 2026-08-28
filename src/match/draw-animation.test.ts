import { describe, expect, it } from "vitest";

import { assembleDeck, deriveExtraDeck } from "../cards/catalog";
import {
  advancePhase,
  createMatch,
  drawCards,
  type MatchState,
} from "../rules/core";
import {
  DrawAnimationQueue,
  drawsForTransition,
} from "./draw-animation";

function activeMatch(): MatchState {
  const match = createMatch({
    playerOneDeck: assembleDeck("fire-water"),
    playerTwoDeck: assembleDeck("earth-air"),
    playerOneExtraDeck: deriveExtraDeck("fire-water"),
    playerTwoExtraDeck: deriveExtraDeck("earth-air"),
  });
  return { ...match, phase: "main", turnNumber: 1 };
}

describe("draw animation queue", () => {
  it("identifies a newly visible local card after the deck shrinks", () => {
    const before = activeMatch();
    const after = drawCards(before, "player-1", 1);

    expect(drawsForTransition(before, after)).toEqual([
      { playerId: "player-1", card: after.players[0].hand.at(-1) },
    ]);
  });

  it("detects the automatic turn draw even though the resulting state is already main phase", () => {
    const before = { ...activeMatch(), phase: "end" as const };
    const after = advancePhase(before);

    expect(after.phase).toBe("main");
    expect(drawsForTransition(before, after)).toEqual([
      { playerId: "player-2", card: after.players[1].hand.at(-1) },
    ]);
  });

  it("preserves the draw order when one spell draws multiple cards", () => {
    const before = activeMatch();
    const after = drawCards(before, "player-1", 2);
    const queue = new DrawAnimationQueue();

    queue.enqueueTransition(before, after);

    expect(queue.length).toBe(2);
    expect(queue.next()?.card?.instanceId).toBe(after.players[0].hand.at(-2)?.instanceId);
    expect(queue.next()?.card?.instanceId).toBe(after.players[0].hand.at(-1)?.instanceId);
    expect(queue.length).toBe(0);
  });

  it("does not animate the opening hand or a mulligan replacement", () => {
    const before = createMatch({
      playerOneDeck: assembleDeck("fire-water"),
      playerTwoDeck: assembleDeck("earth-air"),
    });
    const replacement = {
      ...before,
      players: [
        {
          ...before.players[0],
          hand: before.players[0].deck.slice(0, 4),
          deck: [...before.players[0].hand, ...before.players[0].deck].slice(4),
        },
        before.players[1],
      ] as MatchState["players"],
    };

    expect(drawsForTransition(before, replacement)).toEqual([]);
  });

  it("keeps an anonymous draw queued when a batched update no longer exposes the card", () => {
    const before = activeMatch();
    const drawn = drawCards(before, "player-2", 1);
    const after = {
      ...drawn,
      players: [
        drawn.players[0],
        {
          ...drawn.players[1],
          hand: before.players[1].hand,
        },
      ] as MatchState["players"],
    };

    expect(drawsForTransition(before, after)).toEqual([
      { playerId: "player-2", card: null },
    ]);
  });
});

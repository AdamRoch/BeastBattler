import { describe, expect, it } from "vitest";

import { assembleDeck } from "../cards/catalog";
import { createMatch, type MatchState } from "../rules/core";
import { createSummonTipTracker } from "./summon-tip";

describe("summoning sickness tip", () => {
  it("shows once for the local player's first confirmed base-monster summon", () => {
    const before = matchState();
    const after = withBaseMonster(before, "player-1", "local-monster");
    const later = withBaseMonster(after, "player-1", "another-local-monster");
    const tracker = createSummonTipTracker();

    expect(tracker.shouldShow(before, after, "player-1")).toBe(true);
    expect(tracker.shouldShow(after, later, "player-1")).toBe(false);
  });

  it("does not show for the other player and resets for a rematch", () => {
    const before = matchState();
    const opponentSummon = withBaseMonster(before, "player-2", "opponent-monster");
    const localSummon = withBaseMonster(before, "player-1", "local-monster");
    const tracker = createSummonTipTracker();

    expect(tracker.shouldShow(before, opponentSummon, "player-1")).toBe(false);
    expect(tracker.shouldShow(before, localSummon, "player-1")).toBe(true);
    tracker.reset();
    expect(tracker.shouldShow(before, localSummon, "player-1")).toBe(true);
  });
});

function matchState(): MatchState {
  const deck = assembleDeck("fire-water");
  return createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
}

function withBaseMonster(
  state: MatchState,
  playerId: "player-1" | "player-2",
  instanceId: string,
): MatchState {
  const card = assembleDeck("fire-water").find(
    (candidate) => candidate.kind === "monster",
  );
  if (!card || card.kind !== "monster") {
    throw new Error("Expected a base monster in the deck");
  }

  return {
    ...state,
    players: [
      withSummonedMonster(state.players[0], playerId, card, instanceId, state.turnNumber),
      withSummonedMonster(state.players[1], playerId, card, instanceId, state.turnNumber),
    ],
  };
}

function withSummonedMonster(
  player: MatchState["players"][number],
  playerId: "player-1" | "player-2",
  card: Extract<ReturnType<typeof assembleDeck>[number], { kind: "monster" }>,
  instanceId: string,
  turnNumber: number,
): MatchState["players"][number] {
  if (player.id !== playerId) {
    return player;
  }

  return {
    ...player,
    monsters: [
      ...player.monsters,
      {
        card: { ...card, instanceId },
        damage: 0,
        summonedOnTurn: turnNumber,
        summoningSick: true,
      },
    ],
  };
}

import { describe, expect, it } from "vitest";

import { assembleDeck, deriveExtraDeck } from "../cards/catalog";
import { createMatch } from "../rules/core";
import { filterMatchState } from "./state-filter";

describe("filterMatchState", () => {
  it("shows the viewer's cards while hiding the opponent's hand", () => {
    const state = createMatch({
      playerOneDeck: assembleDeck("fire-water"),
      playerTwoDeck: assembleDeck("earth-air"),
      playerOneExtraDeck: deriveExtraDeck("fire-water"),
      playerTwoExtraDeck: deriveExtraDeck("earth-air"),
    });

    const view = filterMatchState(state, "player-1");

    expect(view.you.hand).toHaveLength(4);
    expect(view.opponent.handCount).toBe(4);
    expect("hand" in view.opponent).toBe(false);
    expect(JSON.stringify(view)).not.toContain(
      state.players[1].hand[0].instanceId,
    );
    expect(view.opponent.extraDeck).toEqual(state.players[1].extraDeck);
  });
});

import { describe, expect, it } from "vitest";

import {
  LOSER_MESSAGE,
  WINNER_GAME_AFTER,
  WINNER_GAME_BEFORE,
  WINNER_MESSAGE,
  resultMessageFor,
  resultMessageMarkup,
} from "./result-message";

describe("result messages", () => {
  it.each([
    ["player-1", "player-1", "win", WINNER_MESSAGE],
    ["player-2", "player-2", "win", WINNER_MESSAGE],
    ["player-1", "player-2", "loss", LOSER_MESSAGE],
    ["player-2", "player-1", "loss", LOSER_MESSAGE],
  ] as const)("shows %s's result to %s as %s", (winner, viewer, outcome, message) => {
    expect(resultMessageFor(winner, viewer)).toEqual({ outcome, message });
  });

  it("renders the winner gag with both required game titles", () => {
    const markup = resultMessageMarkup(resultMessageFor("player-1", "player-1"));

    expect(WINNER_GAME_BEFORE).toBe("You have won at the game of Yu-Gi-Oh!");
    expect(WINNER_GAME_AFTER).toBe("You have won at the game of Beast Battler");
    expect(markup).toContain('class="result-game-title-original"');
    expect(markup).toContain('class="result-game-title-replacement"');
    expect(markup).toContain(WINNER_MESSAGE);
  });

  it("does not give the loser the winner reveal", () => {
    const markup = resultMessageMarkup(resultMessageFor("player-1", "player-2"));

    expect(markup).toContain(LOSER_MESSAGE);
    expect(markup).not.toContain("Yu-Gi-Oh!");
  });
});

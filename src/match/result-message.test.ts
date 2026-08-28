import { describe, expect, it } from "vitest";

import {
  LOSER_MESSAGE,
  OPPOSING_DECK_RAN_DRY,
  OPPOSING_LIFE_REACHED_ZERO,
  WINNER_GAME_AFTER,
  WINNER_GAME_BEFORE,
  WINNER_MESSAGE,
  YOUR_DECK_RAN_DRY,
  YOUR_LIFE_REACHED_ZERO,
  resultMessageFor,
  resultMessageMarkup,
} from "./result-message";

describe("result messages", () => {
  it.each([
    ["player-1", "player-2", "deck-out", "win", WINNER_MESSAGE, OPPOSING_DECK_RAN_DRY],
    ["player-1", "player-2", "deck-out", "loss", LOSER_MESSAGE, YOUR_DECK_RAN_DRY],
    ["player-2", "player-1", "deck-out", "win", WINNER_MESSAGE, OPPOSING_DECK_RAN_DRY],
    ["player-2", "player-1", "deck-out", "loss", LOSER_MESSAGE, YOUR_DECK_RAN_DRY],
    ["player-1", "player-2", "life", "win", WINNER_MESSAGE, OPPOSING_LIFE_REACHED_ZERO],
    ["player-1", "player-2", "life", "loss", LOSER_MESSAGE, YOUR_LIFE_REACHED_ZERO],
    ["player-2", "player-1", "life", "win", WINNER_MESSAGE, OPPOSING_LIFE_REACHED_ZERO],
    ["player-2", "player-1", "life", "loss", LOSER_MESSAGE, YOUR_LIFE_REACHED_ZERO],
  ] as const)("shows %s's %s result to %s as %s", (winner, loser, reason, outcome, message, copy) => {
    const viewer = outcome === "win" ? winner : loser;
    expect(resultMessageFor({ winner, loser, reason }, viewer)).toEqual({
      outcome,
      message,
      reason: copy,
    });
  });

  it("maps an online player-two client to its own result perspective", () => {
    const result = { winner: "player-1", loser: "player-2", reason: "life" } as const;

    expect(resultMessageFor(result, "player-1")).toMatchObject({
      outcome: "win",
      reason: OPPOSING_LIFE_REACHED_ZERO,
    });
    expect(resultMessageFor(result, "player-2")).toMatchObject({
      outcome: "loss",
      reason: YOUR_LIFE_REACHED_ZERO,
    });
  });

  it("renders the winner gag with both required game titles", () => {
    const markup = resultMessageMarkup(resultMessageFor({
      winner: "player-1",
      loser: "player-2",
      reason: "life",
    }, "player-1"));

    expect(WINNER_GAME_BEFORE).toBe("You have won at the game of Yu-Gi-Oh!");
    expect(WINNER_GAME_AFTER).toBe("You have won at the game of Beast Battler");
    expect(markup).toContain(`aria-label="${WINNER_GAME_AFTER}"`);
    expect(markup).toContain('class="result-game-title-original"');
    expect(markup).toContain('class="result-game-title-replacement"');
    expect(markup).toContain(WINNER_MESSAGE);
  });

  it("does not give the loser the winner reveal", () => {
    const markup = resultMessageMarkup(resultMessageFor({
      winner: "player-1",
      loser: "player-2",
      reason: "life",
    }, "player-2"));

    expect(markup).toContain(LOSER_MESSAGE);
    expect(markup).not.toContain("Yu-Gi-Oh!");
  });
});

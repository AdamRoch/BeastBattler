import { describe, expect, it } from "vitest";

import { archetypeCard, resultHandoffScreen, resultScreen } from "./controller";
import { ARCHETYPES } from "../cards/catalog";
import type { AppState } from "./state";

describe("result screens", () => {
  it("keeps VS AI deck-out copy in the human player's perspective", () => {
    const markup = resultScreen(resultState({
      mode: "ai",
      winner: "player-2",
      loser: "player-1",
      reason: "deck-out",
      resultViewingPlayer: "player-1",
    }));

    expect(markup).toContain("DEFEAT");
    expect(markup).toContain("Your deck ran dry.");
  });

  it("shows the winner and loser their own hotseat copy after a handoff", () => {
    const winnerMarkup = resultScreen(resultState({
      mode: "hotseat",
      winner: "player-2",
      loser: "player-1",
      reason: "life",
      resultViewingPlayer: "player-2",
    }));
    const loserMarkup = resultScreen(resultState({
      mode: "hotseat",
      winner: "player-2",
      loser: "player-1",
      reason: "life",
      resultViewingPlayer: "player-1",
    }));
    const handoff = resultHandoffScreen(resultState({
      mode: "hotseat",
      winner: "player-2",
      loser: "player-1",
      reason: "life",
      resultViewingPlayer: "player-2",
    }));

    expect(winnerMarkup).toContain("Yu-Gi-Oh!");
    expect(winnerMarkup).toContain("Wow, you really went beast mode.");
    expect(winnerMarkup).toContain("The opposing life counter reached zero.");
    expect(winnerMarkup).toContain("PASS TO PLAYER 1");
    expect(loserMarkup).toContain("Shadow Realm");
    expect(loserMarkup).toContain("Your life counter reached zero.");
    expect(handoff).toContain("I'M PLAYER 2");
  });
});

describe("deck selection", () => {
  it("describes each deck with a focusable catalog-derived preview", () => {
    const archetype = ARCHETYPES.find((candidate) => candidate.id === "fire-lightning");
    if (!archetype) throw new Error("Missing test archetype");

    const markup = archetypeCard(archetype);

    expect(markup).toContain('aria-describedby="deck-preview-fire-lightning"');
    expect(markup).toContain("20 CARDS");
    expect(markup).toContain("Flying attackers: Volt Bat.");
    expect(markup).toContain("Counter a monster summon or spell.");
  });
});

function resultState(overrides: Pick<AppState, "mode" | "resultViewingPlayer"> & AppState["result"]): AppState {
  return {
    screen: "result",
    mode: overrides.mode,
    selectingPlayer: null,
    playerOneArchetype: "fire-water",
    playerTwoArchetype: "earth-lightning",
    result: {
      winner: overrides.winner,
      loser: overrides.loser,
      reason: overrides.reason,
    },
    resultViewingPlayer: overrides.resultViewingPlayer,
  };
}

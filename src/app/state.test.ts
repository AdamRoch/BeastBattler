import { describe, expect, it } from "vitest";

import {
  continueHotseatDeckSelection,
  createInitialAppState,
  rematch,
  returnToTitle,
  selectArchetype,
  selectMode,
  showModeSelect,
  showResult,
} from "./state";

describe("screen flow state", () => {
  it("routes an AI selection directly into a configured match", () => {
    let state = showModeSelect(createInitialAppState());
    state = selectMode(state, "ai");
    state = selectArchetype(state, "fire-water");

    expect(state).toMatchObject({
      screen: "match",
      mode: "ai",
      selectingPlayer: null,
      playerOneArchetype: "fire-water",
      playerTwoArchetype: "earth-lightning",
    });
  });

  it("requires a device handoff between hotseat deck picks", () => {
    let state = selectMode(showModeSelect(createInitialAppState()), "hotseat");
    state = selectArchetype(state, "water-air");

    expect(state).toMatchObject({
      screen: "deck-handoff",
      mode: "hotseat",
      selectingPlayer: 2,
      playerOneArchetype: "water-air",
      playerTwoArchetype: null,
    });

    state = continueHotseatDeckSelection(state);
    state = selectArchetype(state, "fire-earth");

    expect(state).toMatchObject({
      screen: "match",
      mode: "hotseat",
      selectingPlayer: null,
      playerOneArchetype: "water-air",
      playerTwoArchetype: "fire-earth",
    });
  });

  it("keeps the configured matchup for results and rematches", () => {
    let state = selectMode(showModeSelect(createInitialAppState()), "ai");
    state = selectArchetype(state, "fire-lightning");
    state = showResult(state, {
      winner: "player-1",
      loser: "player-2",
      reason: "life",
    });

    expect(state.screen).toBe("result");
    expect(rematch(state)).toMatchObject({
      screen: "match",
      mode: "ai",
      playerOneArchetype: "fire-lightning",
      playerTwoArchetype: "earth-lightning",
      result: null,
    });
    expect(returnToTitle()).toEqual(createInitialAppState());
  });
});

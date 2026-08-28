import { describe, expect, it } from "vitest";

import {
  continueHotseatDeckSelection,
  continueHotseatResultHandoff,
  createInitialAppState,
  handoffHotseatResult,
  rematch,
  returnToTitle,
  selectArchetype,
  selectMode,
  showOnlineLobby,
  showModeSelect,
  showResult,
} from "./state";

describe("screen flow state", () => {
  it("opens the online lobby without configuring a local match", () => {
    expect(showOnlineLobby(createInitialAppState())).toMatchObject({
      screen: "online-lobby",
      mode: null,
      playerOneArchetype: null,
      playerTwoArchetype: null,
    });
  });

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

  it.each([
    ["player-1", "player-2", "deck-out"],
    ["player-2", "player-1", "life"],
  ] as const)("hands a hotseat result from winner %s to loser %s", (winner, loser, reason) => {
    let state = selectMode(showModeSelect(createInitialAppState()), "hotseat");
    state = selectArchetype(state, "fire-lightning");
    state = continueHotseatDeckSelection(state);
    state = selectArchetype(state, "water-earth");
    state = showResult(state, { winner, loser, reason });

    expect(state).toMatchObject({
      screen: "result-handoff",
      resultViewingPlayer: winner,
    });

    state = continueHotseatResultHandoff(state);
    expect(state).toMatchObject({
      screen: "result",
      resultViewingPlayer: winner,
    });

    state = handoffHotseatResult(state);
    expect(state).toMatchObject({
      screen: "result-handoff",
      resultViewingPlayer: loser,
    });
  });
});

import type { ArchetypeId } from "../cards/catalog";
import type { MatchResult, PlayerId } from "../rules/core";

export type GameMode = "ai" | "hotseat";

export type AppScreen =
  | "title"
  | "mode-select"
  | "online-lobby"
  | "deck-select"
  | "deck-handoff"
  | "match"
  | "result-handoff"
  | "result";

export interface AppState {
  readonly screen: AppScreen;
  readonly mode: GameMode | null;
  readonly selectingPlayer: 1 | 2 | null;
  readonly playerOneArchetype: ArchetypeId | null;
  readonly playerTwoArchetype: ArchetypeId | null;
  readonly result: MatchResult | null;
  readonly resultViewingPlayer: PlayerId | null;
}

const DEFAULT_AI_ARCHETYPE: ArchetypeId = "earth-lightning";

export function createInitialAppState(): AppState {
  return {
    screen: "title",
    mode: null,
    selectingPlayer: null,
    playerOneArchetype: null,
    playerTwoArchetype: null,
    result: null,
    resultViewingPlayer: null,
  };
}

export function showModeSelect(state: AppState): AppState {
  return {
    ...state,
    screen: "mode-select",
    mode: null,
    selectingPlayer: null,
    playerOneArchetype: null,
    playerTwoArchetype: null,
    result: null,
    resultViewingPlayer: null,
  };
}

export function selectMode(state: AppState, mode: GameMode): AppState {
  return {
    ...state,
    screen: "deck-select",
    mode,
    selectingPlayer: 1,
    playerOneArchetype: null,
    playerTwoArchetype: null,
    result: null,
    resultViewingPlayer: null,
  };
}

export function showOnlineLobby(state: AppState): AppState {
  return {
    ...state,
    screen: "online-lobby",
    mode: null,
    selectingPlayer: null,
    playerOneArchetype: null,
    playerTwoArchetype: null,
    result: null,
    resultViewingPlayer: null,
  };
}

export function selectArchetype(
  state: AppState,
  archetypeId: ArchetypeId,
): AppState {
  if (state.screen !== "deck-select" || !state.mode) {
    throw new Error("An archetype can only be selected during deck selection");
  }

  if (state.selectingPlayer === 1) {
    if (state.mode === "ai") {
      return {
        ...state,
        screen: "match",
        selectingPlayer: null,
        playerOneArchetype: archetypeId,
        playerTwoArchetype: DEFAULT_AI_ARCHETYPE,
      };
    }
    return {
      ...state,
      screen: "deck-handoff",
      selectingPlayer: 2,
      playerOneArchetype: archetypeId,
    };
  }

  if (state.selectingPlayer === 2 && state.playerOneArchetype) {
    return {
      ...state,
      screen: "match",
      selectingPlayer: null,
      playerTwoArchetype: archetypeId,
    };
  }

  throw new Error("Deck selection has no active player");
}

export function continueHotseatDeckSelection(state: AppState): AppState {
  if (
    state.screen !== "deck-handoff" ||
    state.mode !== "hotseat" ||
    !state.playerOneArchetype
  ) {
    throw new Error("There is no hotseat deck handoff to continue");
  }
  return { ...state, screen: "deck-select", selectingPlayer: 2 };
}

export function showResult(
  state: AppState,
  result: MatchResult,
): AppState {
  assertConfiguredMatch(state);
  const resultViewingPlayer = state.mode === "hotseat" ? result.winner : "player-1";
  return {
    ...state,
    screen: state.mode === "hotseat" ? "result-handoff" : "result",
    result,
    resultViewingPlayer,
  };
}

export function continueHotseatResultHandoff(state: AppState): AppState {
  if (
    state.screen !== "result-handoff" ||
    state.mode !== "hotseat" ||
    !state.result ||
    !state.resultViewingPlayer
  ) {
    throw new Error("There is no hotseat result handoff to continue");
  }
  return { ...state, screen: "result" };
}

export function handoffHotseatResult(state: AppState): AppState {
  if (
    state.screen !== "result" ||
    state.mode !== "hotseat" ||
    !state.result ||
    !state.resultViewingPlayer
  ) {
    throw new Error("There is no hotseat result to hand off");
  }
  return {
    ...state,
    screen: "result-handoff",
    resultViewingPlayer: state.result.loser,
  };
}

export function rematch(state: AppState): AppState {
  assertConfiguredMatch(state);
  return { ...state, screen: "match", result: null, resultViewingPlayer: null };
}

export function returnToTitle(): AppState {
  return createInitialAppState();
}

export function isConfiguredMatch(
  state: AppState,
): state is AppState & {
  readonly mode: GameMode;
  readonly playerOneArchetype: ArchetypeId;
  readonly playerTwoArchetype: ArchetypeId;
} {
  return Boolean(
    state.mode && state.playerOneArchetype && state.playerTwoArchetype,
  );
}

function assertConfiguredMatch(
  state: AppState,
): asserts state is AppState & {
  readonly mode: GameMode;
  readonly playerOneArchetype: ArchetypeId;
  readonly playerTwoArchetype: ArchetypeId;
} {
  if (!isConfiguredMatch(state)) {
    throw new Error("Both decks and a game mode are required to start a match");
  }
}

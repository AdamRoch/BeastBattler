import type { MatchState, PlayerId, PlayerState } from "../rules/core";
import { opponentOf } from "../rules/core";
import type { DecisionTimer, FilteredMatchState, MatchLogEntry, PrivatePlayerState, PublicPlayerState } from "./protocol";

function privatePlayer(player: PlayerState): PrivatePlayerState {
  return {
    id: player.id, life: player.life, hand: [...player.hand], deckCount: player.deck.length,
    discardPile: [...player.discardPile], extraDeck: [...player.extraDeck], lands: [...player.lands],
    monsters: [...player.monsters], landPlayedThisTurn: player.landPlayedThisTurn,
    mulliganDecision: player.mulliganDecision,
  };
}

function publicPlayer(player: PlayerState): PublicPlayerState {
  return {
    id: player.id, life: player.life, handCount: player.hand.length, deckCount: player.deck.length,
    discardPile: [...player.discardPile], extraDeck: [...player.extraDeck], lands: [...player.lands],
    monsters: [...player.monsters], landPlayedThisTurn: player.landPlayedThisTurn,
    mulliganDecision: player.mulliganDecision,
  };
}

export function filterMatchState(
  state: MatchState,
  viewer: PlayerId,
  log: readonly MatchLogEntry[] = [],
  combat: FilteredMatchState["combat"] = null,
  timers: readonly DecisionTimer[] = [],
  fusionDeclined = false,
): FilteredMatchState {
  const you = state.players.find((player) => player.id === viewer);
  const opponent = state.players.find((player) => player.id === opponentOf(viewer));
  if (!you || !opponent) throw new Error("Match state does not contain both players");
  return {
    you: privatePlayer(you), opponent: publicPlayer(opponent), firstPlayer: state.firstPlayer,
    activePlayer: state.activePlayer, phase: state.phase, turnNumber: state.turnNumber,
    result: state.result, stack: [...state.stack], responsePlayer: state.responsePlayer,
    combat, log: [...log], timers: [...timers], fusionDeclined,
  };
}

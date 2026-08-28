import type { MatchResult, PlayerId } from "../rules/core";

export const WINNER_GAME_INTRO = "You have won at the game of ";
export const WINNER_GAME_BEFORE = `${WINNER_GAME_INTRO}Yu-Gi-Oh!`;
export const WINNER_GAME_AFTER = `${WINNER_GAME_INTRO}Beast Battler`;
export const WINNER_MESSAGE = "Wow, you really went beast mode. Thanks for playing.";
export const LOSER_MESSAGE = "You have been banished to the Shadow Realm for eternity. Sorry, it's nothing personal.";
export const YOUR_DECK_RAN_DRY = "Your deck ran dry.";
export const OPPOSING_DECK_RAN_DRY = "The opposing deck ran dry.";
export const YOUR_LIFE_REACHED_ZERO = "Your life counter reached zero.";
export const OPPOSING_LIFE_REACHED_ZERO = "The opposing life counter reached zero.";

export interface ResultMessage {
  readonly outcome: "win" | "loss";
  readonly message: string;
  readonly reason: string;
}

/** Returns copy from one player's perspective, including hotseat and online. */
export function resultMessageFor(
  result: MatchResult,
  viewingPlayer: PlayerId,
): ResultMessage {
  if (result.winner === viewingPlayer) {
    return {
      outcome: "win",
      message: WINNER_MESSAGE,
      reason: reasonCopy(result.reason, true),
    };
  }
  return {
    outcome: "loss",
    message: LOSER_MESSAGE,
    reason: reasonCopy(result.reason, false),
  };
}

function reasonCopy(
  reason: MatchResult["reason"],
  viewerWon: boolean,
): string {
  if (reason === "deck-out") {
    return viewerWon ? OPPOSING_DECK_RAN_DRY : YOUR_DECK_RAN_DRY;
  }
  return viewerWon ? OPPOSING_LIFE_REACHED_ZERO : YOUR_LIFE_REACHED_ZERO;
}

export function resultMessageMarkup(message: ResultMessage): string {
  if (message.outcome === "loss") {
    return `<p class="result-message">${message.message}</p>`;
  }

  return `
    <div class="result-winner-message">
      <p class="result-game-gag" aria-label="${WINNER_GAME_AFTER}">
        <span>${WINNER_GAME_INTRO}</span><span class="result-game-title"><span class="result-game-title-original">Yu-Gi-Oh!</span><span class="result-game-title-replacement">Beast Battler</span></span>
      </p>
      <p class="result-message">${message.message}</p>
    </div>
  `;
}

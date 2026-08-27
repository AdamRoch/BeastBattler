import {
  getPlayer,
  type GameCard,
  type MatchState,
  type PlayerId,
} from "../rules/core";

export interface QueuedDraw {
  readonly playerId: PlayerId;
  /**
   * A card may have left the hand before a batched state update reaches the
   * renderer. The controller still animates a card back in that case.
   */
  readonly card: GameCard | null;
}

/**
 * Finds cards drawn between two rendered states. Comparing deck size prevents
 * opening hands and mulligan replacements from looking like normal draws.
 */
export function drawsForTransition(
  before: MatchState,
  after: MatchState,
): readonly QueuedDraw[] {
  if (before.phase === "mulligan" || after.phase === "mulligan") {
    return [];
  }

  const draws: QueuedDraw[] = [];
  for (const playerId of ["player-1", "player-2"] as const) {
    const previous = getPlayer(before, playerId);
    const current = getPlayer(after, playerId);
    const drawCount = previous.deck.length - current.deck.length;
    if (drawCount <= 0) {
      continue;
    }

    const previousHand = new Set(previous.hand.map((card) => card.instanceId));
    const newlyVisibleCards = current.hand.filter(
      (card) => !previousHand.has(card.instanceId),
    );
    for (let index = 0; index < drawCount; index += 1) {
      draws.push({
        playerId,
        card: newlyVisibleCards[index] ?? null,
      });
    }
  }

  return draws;
}

export class DrawAnimationQueue {
  private readonly pending: QueuedDraw[] = [];

  enqueueTransition(before: MatchState, after: MatchState): void {
    this.pending.push(...drawsForTransition(before, after));
  }

  next(): QueuedDraw | undefined {
    return this.pending.shift();
  }

  clear(): void {
    this.pending.length = 0;
  }

  get length(): number {
    return this.pending.length;
  }
}

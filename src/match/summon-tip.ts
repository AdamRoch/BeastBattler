import { getPlayer, type MatchState, type PlayerId } from "../rules/core";

export interface SummonTipTracker {
  shouldShow(
    before: MatchState,
    after: MatchState,
    localPlayerId: PlayerId,
  ): boolean;
  reset(): void;
}

export function createSummonTipTracker(): SummonTipTracker {
  let shown = false;

  return {
    shouldShow(before, after, localPlayerId) {
      if (shown) {
        return false;
      }

      const existingIds = new Set(
        getPlayer(before, localPlayerId).monsters.map(
          (monster) => monster.card.instanceId,
        ),
      );
      const summonedBaseMonster = getPlayer(after, localPlayerId).monsters.some(
        (monster) =>
          monster.card.category === "base-monster" &&
          !existingIds.has(monster.card.instanceId),
      );

      if (!summonedBaseMonster) {
        return false;
      }

      shown = true;
      return true;
    },
    reset() {
      shown = false;
    },
  };
}

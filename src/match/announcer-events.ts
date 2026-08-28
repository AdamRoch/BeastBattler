import type { AnnouncerLine } from "../sfx/announcer";
import type { MatchResult, MatchState, PlayerId } from "../rules/core";
import type { CombatPlan } from "../rules/combat";

/** Selects one combat callout. A lethal life result outranks its attack detail. */
export function combatAnnouncement(
  plan: CombatPlan,
  result: MatchResult | null,
): AnnouncerLine {
  if (result?.reason === "life") return "final-blow";
  return plan.blocks.length > 0 ? "attack-blocked" : "direct-attack";
}

/** A level-three upgrade has its own line instead of the generic fusion line. */
export function fusionCompletionAnnouncement(level: 2 | 3): AnnouncerLine {
  return level === 3 ? "three-star-fusion" : "fusion-complete";
}

export function resultAnnouncement(
  result: MatchResult,
  viewingPlayer: PlayerId,
): AnnouncerLine {
  const localLost = result.loser === viewingPlayer;
  if (result.reason === "deck-out") {
    return localLost ? "your-deck-ran-dry" : "opposing-deck-ran-dry";
  }
  return localLost
    ? "your-life-counter-reached-zero"
    : "opposing-life-counter-reached-zero";
}

export function hasBeastFallen(before: MatchState, after: MatchState): boolean {
  const afterIds = new Set(
    after.players.flatMap((player) =>
      player.monsters.map((monster) => monster.card.instanceId),
    ),
  );
  return before.players.some((player) =>
    player.monsters.some((monster) => !afterIds.has(monster.card.instanceId)),
  );
}

/** Keeps replayed snapshots from repeating a line for the same authoritative event. */
export function createAnnouncementDeduper(): {
  once(eventId: string, line: AnnouncerLine): AnnouncerLine | null;
} {
  const announced = new Set<string>();
  return {
    once(eventId, line) {
      if (announced.has(eventId)) return null;
      announced.add(eventId);
      return line;
    },
  };
}

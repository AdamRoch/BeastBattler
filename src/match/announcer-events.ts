import type { AnnouncerLine } from "../sfx/announcer";
import type {
  MatchResult,
  MatchState,
  MonsterPermanent,
  PlayerId,
} from "../rules/core";
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

interface RemovedBeast {
  readonly owner: PlayerId;
  readonly monster: MonsterPermanent;
}

export function fallenBeastIds(
  before: MatchState,
  after: MatchState,
): readonly string[] {
  const afterIds = new Set(
    after.players.flatMap((player) =>
      player.monsters.map((monster) => monster.card.instanceId),
    ),
  );
  const removed: RemovedBeast[] = before.players.flatMap((player) =>
    player.monsters
      .filter((monster) => !afterIds.has(monster.card.instanceId))
      .map((monster) => ({ owner: player.id, monster })),
  );
  const consumed = fusionMaterialIds(before, after, removed);
  return removed
    .map(({ monster }) => monster.card.instanceId)
    .filter((id) => !consumed.has(id));
}

function fusionMaterialIds(
  before: MatchState,
  after: MatchState,
  removed: readonly RemovedBeast[],
): ReadonlySet<string> {
  const consumed = new Set<string>();

  for (const item of after.stack) {
    if (
      item.kind !== "fusion" ||
      before.stack.some((previous) => previous.stackId === item.stackId)
    ) {
      continue;
    }
    for (const parentName of item.parentNames) {
      const parent = removed.find(({ owner, monster }) =>
        owner === item.controller &&
        monster.card.category === "base-monster" &&
        monster.card.name === parentName &&
        !consumed.has(monster.card.instanceId),
      );
      if (parent) consumed.add(parent.monster.card.instanceId);
    }
  }

  for (const afterPlayer of after.players) {
    const beforePlayer = before.players.find((player) => player.id === afterPlayer.id);
    if (!beforePlayer) continue;
    const beforeDiscardIds = new Set(
      beforePlayer.discardPile.map((card) => card.instanceId),
    );
    const newlyDiscardedIds = new Set(
      afterPlayer.discardPile
        .filter((card) => !beforeDiscardIds.has(card.instanceId))
        .map((card) => card.instanceId),
    );
    const upgradedFusions = afterPlayer.monsters.filter((monster) => {
      if (monster.card.category !== "fusion-monster" || monster.card.level !== 3) {
        return false;
      }
      const previous = beforePlayer.monsters.find(
        (candidate) => candidate.card.instanceId === monster.card.instanceId,
      );
      return previous?.card.category === "fusion-monster" && previous.card.level === 2;
    });

    for (const fusion of upgradedFusions) {
      if (fusion.card.category !== "fusion-monster") continue;
      const fusionElements = fusion.card.elements;
      const material = removed.find(({ owner, monster }) =>
        owner === afterPlayer.id &&
        monster.card.category === "base-monster" &&
        fusionElements.includes(monster.card.element) &&
        newlyDiscardedIds.has(monster.card.instanceId) &&
        !consumed.has(monster.card.instanceId),
      );
      if (material) consumed.add(material.monster.card.instanceId);
    }
  }

  return consumed;
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

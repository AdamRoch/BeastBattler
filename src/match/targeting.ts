import type { PlayerId, SpellEffect } from "../rules/core";

export function ownershipLabel(
  controller: PlayerId,
  targetOwner: PlayerId,
): "yours" | "opponent" {
  return controller === targetOwner ? "yours" : "opponent";
}

export function monsterTargetLabel(
  name: string,
  attack: number,
  remainingHealth: number,
  controller: PlayerId,
  targetOwner: PlayerId,
): string {
  return `${name} ${attack}/${remainingHealth} (${ownershipLabel(controller, targetOwner)})`;
}

export function isDestructiveEffect(effect: SpellEffect): boolean {
  return effect.kind === "damage" || effect.kind === "destroy";
}

export function isRecommendedTarget(
  effect: SpellEffect,
  controller: PlayerId,
  targetOwner: PlayerId,
): boolean {
  return isDestructiveEffect(effect) && controller !== targetOwner;
}

export function requiresSelfTargetConfirmation(
  effect: SpellEffect,
  controller: PlayerId,
  targetOwner: PlayerId,
): boolean {
  return isDestructiveEffect(effect) && controller === targetOwner;
}

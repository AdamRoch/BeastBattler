import { describe, expect, it } from "vitest";

import type { SpellEffect } from "../rules/core";
import {
  damageOutcome,
  isRecommendedTarget,
  monsterTargetLabel,
  requiresSelfTargetConfirmation,
} from "./targeting";

const damage: SpellEffect = { kind: "damage", amount: 2, target: "any" };
const destroy: SpellEffect = { kind: "destroy", target: "monster" };
const draw: SpellEffect = { kind: "draw", count: 2 };

describe("damage outcomes", () => {
  it("marks an exact lethal hit as destroyed", () => {
    expect(damageOutcome(2, 2)).toEqual({ remaining: 0, isLethal: true });
  });

  it("shows the surviving monster's remaining HP", () => {
    expect(damageOutcome(3, 2)).toEqual({ remaining: 1, isLethal: false });
  });

  it("computes the LP remaining after damage", () => {
    expect(damageOutcome(10, 2)).toEqual({ remaining: 8, isLethal: false });
  });
});

describe("targeting labels", () => {
  it("marks each monster as yours or the opponent's from its controller", () => {
    expect(monsterTargetLabel("Ember Imp", 2, 1, "player-1", "player-1"))
      .toBe("Ember Imp 2/1 (yours)");
    expect(monsterTargetLabel("Stone Bull", 2, 2, "player-1", "player-2"))
      .toBe("Stone Bull 2/2 (opponent)");
  });
});

describe("targeting recommendations", () => {
  it.each([damage, destroy])(
    "recommends an opponent target for destructive effects",
    (effect) => {
      expect(isRecommendedTarget(effect, "player-1", "player-2")).toBe(true);
      expect(isRecommendedTarget(effect, "player-1", "player-1")).toBe(false);
    },
  );

  it("does not recommend targets for non-destructive effects", () => {
    expect(isRecommendedTarget(draw, "player-1", "player-2")).toBe(false);
  });

  it("asks before a destructive effect hits the controller or their monster", () => {
    expect(requiresSelfTargetConfirmation(damage, "player-1", "player-1")).toBe(true);
    expect(requiresSelfTargetConfirmation(destroy, "player-1", "player-2")).toBe(false);
    expect(requiresSelfTargetConfirmation(draw, "player-1", "player-1")).toBe(false);
  });
});

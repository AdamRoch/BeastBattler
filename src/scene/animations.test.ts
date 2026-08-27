import { describe, expect, it } from "vitest";

import { createArenaScene } from "../arena";

function animationLayer(arena: ReturnType<typeof createArenaScene>) {
  const layer = arena.scene.getObjectByName("arena-animation-effects");
  if (!layer) {
    throw new Error("Missing arena animation effect layer");
  }
  return layer;
}

describe("arena animation events", () => {
  it("plays and cleans up the summon beam and particles", () => {
    const arena = createArenaScene(16 / 9);
    const monster = arena.placeMonster("Reef Guardian", {
      side: "player",
      slot: 0,
    });
    const baseScale = monster.scale.clone();

    arena.update(10);
    arena.dispatchAnimation({ type: "summon", monsterId: "Reef Guardian" });
    arena.update(10.6);

    expect(animationLayer(arena).getObjectByName("summon-beam")).toBeDefined();
    expect(monster.scale.equals(baseScale)).toBe(false);

    arena.update(11.4);
    expect(animationLayer(arena).children).toHaveLength(0);
    expect(monster.scale.toArray()).toEqual(baseScale.toArray());
  });

  it("animates attack, hit, and death without changing rules state", () => {
    const arena = createArenaScene(16 / 9);
    const attacker = arena.placeMonster("Reef Guardian", {
      side: "player",
      slot: 0,
    });
    arena.placeMonster("Ember Imp", { side: "opponent", slot: 0 });
    const basePosition = attacker.position.clone();

    arena.update(20);
    arena.dispatchAnimation({
      type: "attack",
      attackerId: "Reef Guardian",
      target: { kind: "monster", monsterId: "Ember Imp" },
    });
    arena.update(20.35);
    expect(attacker.position.equals(basePosition)).toBe(false);
    expect(animationLayer(arena).getObjectByName("animation-flash")).toBeDefined();

    arena.update(20.8);
    expect(attacker.position.toArray()).toEqual(basePosition.toArray());

    arena.dispatchAnimation({
      type: "hit",
      monsterId: "Reef Guardian",
      from: { kind: "monster", monsterId: "Ember Imp" },
    });
    arena.update(21.05);
    expect(attacker.position.equals(basePosition)).toBe(false);
    arena.update(21.35);
    expect(attacker.position.toArray()).toEqual(basePosition.toArray());

    arena.dispatchAnimation({ type: "death", monsterId: "Reef Guardian" });
    arena.update(22.45);
    expect(attacker.visible).toBe(false);
    expect(arena.getMonster("Reef Guardian")).toBe(attacker);
  });

  it("plays the fusion spiral and the shorter star3 sequence", () => {
    const arena = createArenaScene(16 / 9);
    const first = arena.placeMonster("Ember Imp", {
      side: "player",
      slot: 0,
    });
    const result = arena.placeMonster("Plasma Beast", {
      side: "player",
      slot: 1,
    });
    const second = arena.placeMonster("Reef Guardian", {
      side: "player",
      slot: 2,
    });
    const firstPosition = first.position.clone();

    arena.update(30);
    arena.dispatchAnimation({
      type: "fusion",
      sourceIds: ["Ember Imp", "Reef Guardian"],
      resultId: "Plasma Beast",
    });
    arena.update(31);
    expect(first.position.equals(firstPosition)).toBe(false);
    expect(result.scale.x).toBeGreaterThan(1);
    expect(animationLayer(arena).getObjectByName("animation-flash")).toBeDefined();
    arena.update(32.5);
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(false);

    first.visible = true;
    second.visible = true;
    arena.dispatchAnimation({
      type: "fusion",
      sourceIds: ["Ember Imp", "Reef Guardian"],
      resultId: "Plasma Beast",
      variant: "star3",
    });
    arena.update(33.9);
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(false);
  });

  it("creates each spell signature and the Burst bolt", () => {
    const arena = createArenaScene(16 / 9);
    arena.placeMonster("Reef Guardian", { side: "player", slot: 0 });
    arena.placeMonster("Ember Imp", { side: "opponent", slot: 0 });
    const source = { kind: "monster", monsterId: "Reef Guardian" } as const;
    const target = { kind: "monster", monsterId: "Ember Imp" } as const;

    arena.update(40);
    arena.dispatchAnimation({ type: "spell", spell: "bolt", source, target });
    arena.dispatchAnimation({ type: "spell", spell: "destroy", source, target });
    arena.dispatchAnimation({ type: "spell", spell: "draw", source });
    arena.dispatchAnimation({
      type: "spell",
      spell: "counterspell",
      source,
      target,
    });
    arena.dispatchAnimation({ type: "burst", source, target });
    arena.update(40.1);

    const names = animationLayer(arena).children.map((child) => child.name);
    expect(names).toContain("projectile-streak");
    expect(names).toContain("destroy-shatter");
    expect(names).toContain("draw-flourish");
    expect(names).toContain("counterspell-ripple");

    arena.update(41.1);
    expect(animationLayer(arena).children).toHaveLength(0);
  });

  it("fails fast when an event references a missing monster", () => {
    const arena = createArenaScene(16 / 9);
    expect(() =>
      arena.dispatchAnimation({ type: "summon", monsterId: "Missing Beast" }),
    ).toThrow("Cannot animate missing monster: Missing Beast");
  });
});

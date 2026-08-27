import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { createArenaScene } from "./arena";

describe("createArenaScene", () => {
  it("creates the dark arena placeholder with a fixed camera and floor grid", () => {
    const { scene, camera, floorGrid } = createArenaScene(16 / 9);

    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHex()).toBe(0x05070d);
    expect(camera.aspect).toBe(16 / 9);
    expect(camera.position.toArray()).toEqual([7, 7, 9]);
    expect(scene.children).toContain(floorGrid);
    expect((floorGrid.material as THREE.Material).opacity).toBe(0.35);
  });

  it("stages a fusion result while keeping both sources available to animate", () => {
    const arena = createArenaScene(16 / 9);
    const first = arena.placeMonster("Ember Imp", { side: "player", slot: 0 });
    const second = arena.placeMonster("Cinder Wall", { side: "player", slot: 1 });

    const result = arena.stageFusion(
      ["Ember Imp", "Cinder Wall"],
      "Inferno Beast",
    );

    expect(arena.getMonster("Ember Imp")).toBe(first);
    expect(arena.getMonster("Cinder Wall")).toBe(second);
    expect(arena.getMonster("Inferno Beast")).toBe(result);
    expect(arena.getMonsterAt({ side: "player", slot: 0 })).toBe(result);
    expect(() =>
      arena.dispatchAnimation({
        type: "fusion",
        sourceIds: ["Ember Imp", "Cinder Wall"],
        resultId: "Inferno Beast",
      }),
    ).not.toThrow();

    arena.removeMonster("Ember Imp");
    expect(arena.getMonsterAt({ side: "player", slot: 0 })).toBe(result);
  });

  it.each([
    ["player", Math.PI],
    ["opponent", 0],
  ] as const)(
    "settles a staged fusion on the %s side's canonical facing",
    (side, expectedYaw) => {
      const arena = createArenaScene(16 / 9);
      arena.placeMonster("Ember Imp", { side, slot: 0 });
      arena.placeMonster("Cinder Wall", { side, slot: 1 });
      const result = arena.stageFusion(
        ["Ember Imp", "Cinder Wall"],
        "Inferno Beast",
      );

      arena.update(0);
      arena.dispatchAnimation({
        type: "fusion",
        sourceIds: ["Ember Imp", "Cinder Wall"],
        resultId: "Inferno Beast",
      });
      arena.update(2.5);

      expect(result.rotation.y).toBeCloseTo(expectedYaw);
    },
  );

  it("publishes animation events to read-only integrations", () => {
    const arena = createArenaScene(16 / 9);
    arena.placeMonster("Ember Imp", { side: "player", slot: 0 });
    const events: string[] = [];
    const unsubscribe = arena.onAnimationEvent((event) => events.push(event.type));

    arena.dispatchAnimation({ type: "summon", monsterId: "Ember Imp" });
    unsubscribe();
    arena.dispatchAnimation({ type: "hit", monsterId: "Ember Imp" });

    expect(events).toEqual(["summon"]);
  });

  it("maps live summoning sickness onto the placed monster", () => {
    const arena = createArenaScene(16 / 9);
    const monster = arena.placeMonster("Ember Imp", { side: "player", slot: 0 });

    arena.setMonsterSummoningSickness("Ember Imp", true);
    expect(monster.getObjectByName("summoning-sickness-indicator")).toBeTruthy();

    arena.setMonsterSummoningSickness("Ember Imp", false);
    expect(monster.getObjectByName("summoning-sickness-indicator")).toBeUndefined();
  });

  it("identifies a monster through its child mesh at a normalized screen point", () => {
    const arena = createArenaScene(16 / 9);
    const model = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    body.position.y = 0.5;
    model.add(body);
    arena.placeMonster("hovered-monster", { side: "player", slot: 1 }, model);

    arena.scene.updateMatrixWorld(true);
    arena.camera.updateMatrixWorld();
    const point = body.getWorldPosition(new THREE.Vector3()).project(arena.camera);

    expect(arena.pickMonsterAt(point.x, point.y)).toBe("hovered-monster");
    expect(arena.pickMonsterAt(2, 2)).toBeNull();
  });
});

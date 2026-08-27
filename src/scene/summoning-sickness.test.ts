import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  hasSummoningSicknessIndicator,
  setSummoningSicknessIndicator,
  updateSummoningSicknessIndicator,
} from "./summoning-sickness";

describe("summoning sickness indicator", () => {
  it("adds a hologram ring above a monster and removes it as soon as the monster is ready", () => {
    const monster = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    body.position.y = 0.5;
    monster.add(body);

    setSummoningSicknessIndicator(monster, true);

    expect(hasSummoningSicknessIndicator(monster)).toBe(true);
    const indicator = monster.getObjectByName("summoning-sickness-indicator");
    expect(indicator?.position.y).toBeGreaterThan(1);

    updateSummoningSicknessIndicator(monster, 2);
    expect(indicator?.rotation.y).toBeCloseTo(1.44);

    setSummoningSicknessIndicator(monster, false);
    expect(hasSummoningSicknessIndicator(monster)).toBe(false);
  });
});

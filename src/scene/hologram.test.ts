import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { ASSIGNED_MONSTER_IDS, createMonsterModel } from "../models";
import {
  applyHologramTreatment,
  HOLOGRAM_ELEMENT_COLORS,
  isHologramMaterial,
  setHologramAnimationState,
  updateHologramTime,
} from "./hologram";

describe("hologram treatment", () => {
  it("replaces mesh materials with transparent additive shader materials", () => {
    const model = new THREE.Group();
    model.name = "test-monster";
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x123456 }),
    );
    model.add(mesh);

    applyHologramTreatment(model, {
      primary: "water",
      secondary: "lightning",
    });

    if (!isHologramMaterial(mesh.material)) {
      throw new Error("Expected a hologram shader material");
    }
    const material = mesh.material;
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.uPrimaryColor?.value.getHex()).toBe(
      HOLOGRAM_ELEMENT_COLORS.water,
    );
    expect(material.uniforms.uSecondaryColor?.value.getHex()).toBe(
      HOLOGRAM_ELEMENT_COLORS.lightning,
    );

    updateHologramTime(model, 4.25);
    expect(material.uniforms.uTime?.value).toBe(4.25);

    setHologramAnimationState(model, {
      dissolve: 0.7,
      flash: 0.8,
      glitch: 0.6,
      reveal: 0.4,
    });
    expect(material.uniforms.uDissolveProgress?.value).toBe(0.7);
    expect(material.uniforms.uFlashAmount?.value).toBe(0.8);
    expect(material.uniforms.uGlitchAmount?.value).toBe(0.6);
    expect(material.uniforms.uRevealProgress?.value).toBe(0.4);
  });

  it("applies the shared shader to every mesh in every current model", () => {
    for (const cardId of ASSIGNED_MONSTER_IDS) {
      const model = createMonsterModel(cardId);
      let meshCount = 0;

      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
          return;
        }

        meshCount += 1;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        expect(materials.every(isHologramMaterial)).toBe(true);
      });

      expect(meshCount).toBeGreaterThan(0);
    }
  });
});

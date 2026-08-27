import * as THREE from "three";

import type { PlayerSide } from "./zones";

export type ArenaElement = "fire" | "water" | "earth" | "air" | "lightning";

export const ELEMENT_COLORS: Readonly<Record<ArenaElement, number>> = {
  fire: 0xff542e,
  water: 0x29a8ff,
  earth: 0xc58a45,
  air: 0x7de2c4,
  lightning: 0xb68cff,
};

export interface ArenaLighting {
  group: THREE.Group;
  sideLights: Record<PlayerSide, THREE.PointLight>;
  setSideElement(side: PlayerSide, element: ArenaElement): void;
  getSideColor(side: PlayerSide): THREE.Color;
}

function createAccent(
  side: PlayerSide,
  z: number,
  color: number,
): { light: THREE.PointLight; rail: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> } {
  const light = new THREE.PointLight(color, 22, 11, 2);
  light.name = `${side}-element-light`;
  light.position.set(0, 2.4, z);

  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 2.2,
    roughness: 0.5,
    metalness: 0.35,
  });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.04, 0.08), material);
  rail.name = `${side}-accent-rail`;
  rail.position.set(0, 0.055, z);

  return { light, rail };
}

export function createArenaLighting(): ArenaLighting {
  const group = new THREE.Group();
  group.name = "arena-lighting";

  const ambient = new THREE.HemisphereLight(0x5d76a5, 0x03050a, 0.55);
  ambient.name = "arena-ambient-light";

  const overhead = new THREE.DirectionalLight(0xb9c8e8, 1.15);
  overhead.name = "arena-overhead-light";
  overhead.position.set(2, 9, 4);

  const playerAccent = createAccent("player", 5.55, ELEMENT_COLORS.water);
  const opponentAccent = createAccent("opponent", -5.55, ELEMENT_COLORS.fire);

  group.add(
    ambient,
    overhead,
    playerAccent.light,
    playerAccent.rail,
    opponentAccent.light,
    opponentAccent.rail,
  );

  const accents = {
    player: playerAccent,
    opponent: opponentAccent,
  };

  return {
    group,
    sideLights: {
      player: playerAccent.light,
      opponent: opponentAccent.light,
    },
    setSideElement(side, element) {
      const color = ELEMENT_COLORS[element];
      accents[side].light.color.setHex(color);
      accents[side].rail.material.color.setHex(color);
      accents[side].rail.material.emissive.setHex(color);
    },
    getSideColor(side) {
      return accents[side].light.color;
    },
  };
}

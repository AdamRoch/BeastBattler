import * as THREE from "three";

import {
  applyHologramTreatment,
  type HologramPalette,
} from "../scene/hologram";

export const ASSIGNED_MONSTER_IDS = [
  "Ember Imp",
  "Tide Serpent",
  "Stone Bull",
  "Gale Hawk",
  "Cloud Sprite",
  "Reef Guardian",
  "Moss Tortoise",
  "Spark Lynx",
  "Volt Bat",
  "Steam Beast",
  "Tsunami Beast",
  "Swamp Beast",
  "Ice Beast",
  "Storm Beast",
  "Golem Beast",
  "Sandstorm Beast",
  "Crystal Beast",
  "Cyclone Beast",
  "Thunderbird Beast",
  "Thunder Beast",
  "Cinder Wall",
  "Inferno Beast",
  "Magma Beast",
  "Wildfire Beast",
  "Plasma Beast",
] as const;

export type AssignedMonsterId = (typeof ASSIGNED_MONSTER_IDS)[number];

const MONSTER_HOLOGRAM_PALETTES: Readonly<
  Record<AssignedMonsterId, HologramPalette>
> = {
  "Ember Imp": { primary: "fire" },
  "Tide Serpent": { primary: "water" },
  "Stone Bull": { primary: "earth" },
  "Gale Hawk": { primary: "air" },
  "Cloud Sprite": { primary: "air" },
  "Reef Guardian": { primary: "water" },
  "Moss Tortoise": { primary: "earth" },
  "Spark Lynx": { primary: "lightning" },
  "Volt Bat": { primary: "lightning" },
  "Steam Beast": { primary: "water", secondary: "fire" },
  "Tsunami Beast": { primary: "water" },
  "Swamp Beast": { primary: "water", secondary: "earth" },
  "Ice Beast": { primary: "water", secondary: "air" },
  "Storm Beast": { primary: "water", secondary: "lightning" },
  "Golem Beast": { primary: "earth" },
  "Sandstorm Beast": { primary: "earth", secondary: "air" },
  "Crystal Beast": { primary: "earth", secondary: "lightning" },
  "Cyclone Beast": { primary: "air" },
  "Thunderbird Beast": { primary: "air", secondary: "lightning" },
  "Thunder Beast": { primary: "lightning" },
  "Cinder Wall": { primary: "fire" },
  "Inferno Beast": { primary: "fire" },
  "Magma Beast": { primary: "fire", secondary: "earth" },
  "Wildfire Beast": { primary: "fire", secondary: "air" },
  "Plasma Beast": { primary: "fire", secondary: "lightning" },
};

export function getMonsterHologramPalette(
  cardId: AssignedMonsterId,
): Readonly<HologramPalette> {
  return MONSTER_HOLOGRAM_PALETTES[cardId];
}

type Palette = {
  dark: number;
  body: number;
  accent: number;
  light: number;
};

const FIRE: Palette = {
  dark: 0x42141a,
  body: 0xa42d16,
  accent: 0xf05a18,
  light: 0xffc43d,
};

const WATER: Palette = {
  dark: 0x082c4d,
  body: 0x0d5f86,
  accent: 0x19b8cc,
  light: 0x8df7ff,
};

const EARTH: Palette = {
  dark: 0x30241e,
  body: 0x765039,
  accent: 0x8da18d,
  light: 0x77ad62,
};

const AIR: Palette = {
  dark: 0x35465e,
  body: 0xd9efff,
  accent: 0x8cecff,
  light: 0xffffff,
};

const LIGHTNING: Palette = {
  dark: 0x2d225d,
  body: 0x5d45c9,
  accent: 0xffd43b,
  light: 0xf6f1a0,
};

const TAU = Math.PI * 2;

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.68,
    metalness: 0.12,
    emissive: color,
    emissiveIntensity: 0.08,
  });
}

function mesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  color: number,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material(color));
  part.position.set(...position);
  part.rotation.set(...rotation);
  part.scale.set(...scale);
  group.add(part);
  return part;
}

function box(
  group: THREE.Group,
  size: [number, number, number],
  color: number,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  return mesh(
    group,
    new THREE.BoxGeometry(...size),
    color,
    position,
    rotation,
    scale,
  );
}

function sphere(
  group: THREE.Group,
  radius: number,
  color: number,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  return mesh(
    group,
    new THREE.SphereGeometry(radius, 8, 6),
    color,
    position,
    [0, 0, 0],
    scale,
  );
}

function cone(
  group: THREE.Group,
  radius: number,
  height: number,
  color: number,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  return mesh(
    group,
    new THREE.ConeGeometry(radius, height, 6),
    color,
    position,
    rotation,
    scale,
  );
}

function cylinder(
  group: THREE.Group,
  radius: number,
  height: number,
  color: number,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  return mesh(
    group,
    new THREE.CylinderGeometry(radius, radius * 1.08, height, 8),
    color,
    position,
    rotation,
    scale,
  );
}

function torus(
  group: THREE.Group,
  radius: number,
  tube: number,
  color: number,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  return mesh(
    group,
    new THREE.TorusGeometry(radius, tube, 5, 10),
    color,
    position,
    rotation,
  );
}

function flame(
  group: THREE.Group,
  palette: Palette,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): void {
  cone(group, 0.15, 0.48, palette.accent, position, rotation, scale);
  cone(
    group,
    0.08,
    0.3,
    palette.light,
    [position[0], position[1] + 0.1, position[2]],
    rotation,
    [scale[0] * 0.72, scale[1] * 0.72, scale[2] * 0.72],
  );
}

function fin(
  group: THREE.Group,
  color: number,
  position: [number, number, number],
  rotation: [number, number, number],
  scale: [number, number, number],
): void {
  cone(group, 0.18, 0.55, color, position, rotation, scale);
}

function buildEmberImp(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.34, FIRE.body, [0, 0.58, 0], [1, 1.15, 0.9]);
  sphere(group, 0.27, FIRE.accent, [0, 1.1, 0.02], [1, 1.08, 0.9]);
  sphere(group, 0.045, FIRE.light, [-0.1, 1.13, -0.24]);
  sphere(group, 0.045, FIRE.light, [0.1, 1.13, -0.24]);
  cone(group, 0.08, 0.35, FIRE.dark, [-0.17, 1.43, 0], [0, 0, -0.22]);
  cone(group, 0.08, 0.35, FIRE.dark, [0.17, 1.43, 0], [0, 0, 0.22]);
  cone(group, 0.13, 0.38, FIRE.accent, [-0.38, 0.62, 0], [0, 0, Math.PI / 2]);
  cone(group, 0.13, 0.38, FIRE.accent, [0.38, 0.62, 0], [0, 0, -Math.PI / 2]);
  cylinder(group, 0.11, 0.2, FIRE.dark, [-0.16, 0.16, 0]);
  cylinder(group, 0.11, 0.2, FIRE.dark, [0.16, 0.16, 0]);
  flame(group, FIRE, [0, 0.15, 0.22], [0.72, 0.7, 0.72]);
  return group;
}

function buildCinderWall(): THREE.Group {
  const group = new THREE.Group();
  box(group, [0.72, 0.95, 0.34], FIRE.body, [0, 0.55, 0]);
  box(group, [0.57, 0.18, 0.39], FIRE.dark, [0, 1.07, 0]);
  box(group, [0.2, 0.2, 0.42], FIRE.accent, [-0.26, 1.22, 0]);
  box(group, [0.2, 0.2, 0.42], FIRE.accent, [0.26, 1.22, 0]);
  box(group, [0.22, 0.58, 0.08], FIRE.light, [-0.19, 0.58, -0.2], [0, 0, -0.08]);
  box(group, [0.16, 0.36, 0.08], FIRE.accent, [0.13, 0.33, -0.2], [0, 0, 0.08]);
  cylinder(group, 0.12, 0.3, FIRE.dark, [-0.49, 0.16, 0], [0, 0, 0], [1, 1, 0.8]);
  cylinder(group, 0.12, 0.3, FIRE.dark, [0.49, 0.16, 0], [0, 0, 0], [1, 1, 0.8]);
  flame(group, FIRE, [-0.49, 0.38, 0], [0.56, 0.7, 0.56]);
  flame(group, FIRE, [0.49, 0.38, 0], [0.56, 0.7, 0.56]);
  return group;
}

function buildInfernoBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.47, FIRE.dark, [0, 0.67, 0], [1.25, 0.92, 0.9]);
  sphere(group, 0.32, FIRE.body, [0, 1.2, -0.08], [1.1, 0.95, 0.9]);
  cone(group, 0.1, 0.36, FIRE.light, [-0.2, 1.53, 0], [0, 0, -0.2]);
  cone(group, 0.1, 0.36, FIRE.light, [0.2, 1.53, 0], [0, 0, 0.2]);
  for (const x of [-0.29, 0.29]) {
    cylinder(group, 0.09, 0.44, FIRE.body, [x, 0.3, -0.1], [0, 0.08 * Math.sign(x), 0]);
  }
  flame(group, FIRE, [-0.39, 1.14, 0.08], [0.72, 1.05, 0.72], [0.1, 0, -0.3]);
  flame(group, FIRE, [0.39, 1.14, 0.08], [0.72, 1.05, 0.72], [-0.1, 0, 0.3]);
  flame(group, FIRE, [0, 0.57, 0.52], [0.75, 0.95, 0.75], [Math.PI / 2, 0, 0]);
  return group;
}

function buildMagmaBeast(): THREE.Group {
  const group = new THREE.Group();
  box(group, [0.74, 0.72, 0.66], FIRE.dark, [0, 0.73, 0], [0, 0.16, 0]);
  box(group, [0.46, 0.46, 0.46], FIRE.body, [0, 1.22, -0.03], [0, -0.12, 0]);
  cone(group, 0.16, 0.44, FIRE.accent, [-0.22, 1.56, 0], [0, 0, -0.18]);
  cone(group, 0.16, 0.44, FIRE.accent, [0.22, 1.56, 0], [0, 0, 0.18]);
  for (const x of [-0.27, 0.27]) {
    box(group, [0.2, 0.4, 0.2], FIRE.body, [x, 0.25, -0.12], [0, 0.1 * Math.sign(x), 0]);
  }
  box(group, [0.08, 0.44, 0.08], FIRE.light, [-0.2, 0.74, -0.35], [0, 0, -0.24]);
  box(group, [0.08, 0.38, 0.08], FIRE.accent, [0.18, 0.76, -0.35], [0, 0, 0.2]);
  flame(group, FIRE, [0, 0.85, 0.38], [0.72, 0.95, 0.72], [Math.PI / 2, 0, 0]);
  return group;
}

function buildWildfireBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.46, FIRE.body, [0, 0.72, 0], [1.25, 0.84, 0.88]);
  sphere(group, 0.3, FIRE.dark, [0, 1.22, -0.12], [1, 0.9, 0.9]);
  cone(group, 0.1, 0.3, FIRE.light, [-0.19, 1.5, 0], [0, 0, -0.3]);
  cone(group, 0.1, 0.3, FIRE.light, [0.19, 1.5, 0], [0, 0, 0.3]);
  for (const x of [-0.3, 0.3]) {
    cylinder(group, 0.085, 0.42, FIRE.dark, [x, 0.27, -0.12], [0, 0, 0]);
  }
  box(group, [0.11, 0.42, 0.3], FIRE.accent, [-0.48, 0.79, 0], [0, 0, -0.3]);
  box(group, [0.11, 0.42, 0.3], FIRE.accent, [0.48, 0.79, 0], [0, 0, 0.3]);
  flame(group, FIRE, [0, 0.72, 0.52], [0.78, 1.25, 0.78], [Math.PI / 2, 0, 0]);
  flame(group, FIRE, [0.42, 0.72, 0.3], [0.55, 0.95, 0.55], [Math.PI / 2, 0.3, 0]);
  return group;
}

function buildPlasmaBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.42, FIRE.dark, [0, 0.83, 0], [1, 1.15, 1]);
  sphere(group, 0.21, FIRE.light, [0, 0.83, -0.38]);
  torus(group, 0.48, 0.045, FIRE.accent, [0, 0.83, 0], [Math.PI / 2, 0, 0]);
  for (const [x, z, rotation] of [
    [-0.28, 0, -0.35],
    [0.28, 0, 0.35],
    [0, 0.28, Math.PI / 2],
  ] as const) {
    cylinder(group, 0.045, 0.42, FIRE.accent, [x, 0.83, z], [0, rotation, Math.PI / 2]);
  }
  cone(group, 0.12, 0.38, FIRE.light, [-0.34, 1.27, 0], [0, 0, -0.42]);
  cone(group, 0.12, 0.38, FIRE.light, [0.34, 1.27, 0], [0, 0, 0.42]);
  flame(group, FIRE, [0, 0.17, 0], [0.7, 0.7, 0.7]);
  return group;
}

function buildReefGuardian(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.43, WATER.body, [0, 0.55, 0], [1.18, 0.84, 1]);
  sphere(group, 0.32, WATER.dark, [0, 1.1, -0.08], [0.9, 0.88, 0.86]);
  torus(group, 0.33, 0.08, WATER.accent, [0, 0.62, 0.03], [Math.PI / 2, 0, 0]);
  for (const x of [-0.27, 0.27]) {
    fin(group, WATER.accent, [x, 0.6, 0.06], [0, 0, x < 0 ? -0.9 : 0.9], [1.1, 1, 0.55]);
  }
  fin(group, WATER.light, [0, 0.65, 0.44], [Math.PI / 2, 0, 0], [0.8, 1.1, 0.8]);
  cone(group, 0.1, 0.3, WATER.light, [-0.16, 1.42, 0], [0, 0, -0.18]);
  cone(group, 0.1, 0.3, WATER.light, [0.16, 1.42, 0], [0, 0, 0.18]);
  cylinder(group, 0.1, 0.2, WATER.dark, [-0.19, 0.13, -0.06]);
  cylinder(group, 0.1, 0.2, WATER.dark, [0.19, 0.13, -0.06]);
  sphere(group, 0.06, WATER.light, [0, 1.1, -0.3], [1, 1, 0.45]);
  return group;
}

function buildSteamBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.43, WATER.dark, [0, 0.68, 0], [1.25, 0.86, 0.9]);
  sphere(group, 0.29, WATER.body, [0, 1.16, -0.08], [1, 0.92, 0.9]);
  sphere(group, 0.2, WATER.light, [-0.27, 1.25, 0.02]);
  sphere(group, 0.16, WATER.light, [0.26, 1.39, 0.02]);
  sphere(group, 0.12, WATER.accent, [0.38, 1.5, 0.03]);
  cylinder(group, 0.12, 0.28, FIRE.body, [-0.28, 1.5, 0.02]);
  cylinder(group, 0.1, 0.34, FIRE.accent, [0.27, 1.49, 0.03]);
  for (const x of [-0.29, 0.29]) {
    cylinder(group, 0.08, 0.4, WATER.body, [x, 0.27, -0.1]);
  }
  fin(group, WATER.accent, [-0.47, 0.8, 0], [0, 0, -0.4], [0.8, 1, 0.65]);
  fin(group, WATER.accent, [0.47, 0.8, 0], [0, 0, 0.4], [0.8, 1, 0.65]);
  flame(group, FIRE, [0, 0.74, 0.45], [0.62, 0.9, 0.62], [Math.PI / 2, 0, 0]);
  return group;
}

function buildSparkLynx(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.43, LIGHTNING.body, [0, 0.67, 0], [1.25, 0.82, 0.84]);
  sphere(group, 0.3, LIGHTNING.dark, [0, 1.16, -0.11], [1, 0.92, 0.9]);
  cone(group, 0.11, 0.38, LIGHTNING.accent, [-0.18, 1.49, 0], [0, 0, -0.22]);
  cone(group, 0.11, 0.38, LIGHTNING.accent, [0.18, 1.49, 0], [0, 0, 0.22]);
  sphere(group, 0.045, LIGHTNING.light, [-0.1, 1.17, -0.27]);
  sphere(group, 0.045, LIGHTNING.light, [0.1, 1.17, -0.27]);
  for (const x of [-0.28, 0.28]) {
    cylinder(group, 0.085, 0.45, LIGHTNING.dark, [x, 0.25, -0.12], [0, 0, 0]);
  }
  box(group, [0.1, 0.1, 0.52], LIGHTNING.accent, [0, 0.68, 0.52], [0.65, 0, 0]);
  box(group, [0.1, 0.1, 0.4], LIGHTNING.light, [0.16, 0.9, 0.82], [-0.65, 0, 0]);
  box(group, [0.1, 0.1, 0.3], LIGHTNING.accent, [0.29, 1.06, 1.1], [0.65, 0, 0]);
  return group;
}

function buildGolemBeast(): THREE.Group {
  const group = new THREE.Group();
  box(group, [0.72, 0.68, 0.58], EARTH.body, [0, 0.72, 0], [0, 0.1, 0]);
  box(group, [0.51, 0.5, 0.48], EARTH.accent, [0, 1.2, -0.04], [0, -0.08, 0]);
  box(group, [0.2, 0.28, 0.2], EARTH.dark, [-0.38, 0.8, 0]);
  box(group, [0.2, 0.28, 0.2], EARTH.dark, [0.38, 0.8, 0]);
  box(group, [0.12, 0.22, 0.08], EARTH.light, [-0.12, 1.23, -0.27]);
  box(group, [0.12, 0.22, 0.08], EARTH.light, [0.12, 1.23, -0.27]);
  for (const x of [-0.26, 0.26]) {
    box(group, [0.24, 0.43, 0.24], EARTH.dark, [x, 0.27, -0.08], [0, 0.08 * Math.sign(x), 0]);
  }
  box(group, [0.14, 0.68, 0.14], EARTH.light, [-0.18, 0.76, -0.32], [0, 0, -0.2]);
  box(group, [0.14, 0.52, 0.14], EARTH.light, [0.2, 0.76, -0.32], [0, 0, 0.18]);
  cone(group, 0.18, 0.4, EARTH.light, [0, 1.58, 0], [0, 0, 0]);
  return group;
}

function buildThunderbirdBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.42, AIR.body, [0, 0.75, 0], [1.15, 0.9, 0.88]);
  sphere(group, 0.3, AIR.dark, [0, 1.21, -0.09], [0.95, 0.92, 0.9]);
  cone(group, 0.1, 0.36, AIR.accent, [-0.16, 1.53, 0], [0, 0, -0.22]);
  cone(group, 0.1, 0.36, AIR.accent, [0.16, 1.53, 0], [0, 0, 0.22]);
  cone(group, 0.1, 0.28, LIGHTNING.accent, [0, 1.18, -0.38], [Math.PI / 2, 0, 0]);
  box(group, [0.12, 0.46, 0.62], AIR.accent, [-0.47, 0.86, 0], [0.12, 0, -0.25]);
  box(group, [0.12, 0.46, 0.62], AIR.accent, [0.47, 0.86, 0], [-0.12, 0, 0.25]);
  for (const x of [-0.26, 0.26]) {
    cylinder(group, 0.08, 0.4, AIR.dark, [x, 0.28, -0.12]);
  }
  box(group, [0.1, 0.1, 0.5], LIGHTNING.accent, [0, 0.7, 0.48], [0.55, 0, 0]);
  box(group, [0.1, 0.1, 0.38], LIGHTNING.accent, [0.16, 0.9, 0.85], [-0.55, 0, 0]);
  return group;
}

function buildTideSerpent(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.42, WATER.body, [0, 0.58, 0], [1.45, 0.72, 0.72]);
  sphere(group, 0.3, WATER.dark, [0, 1.08, -0.28], [0.92, 0.9, 0.82]);
  sphere(group, 0.045, WATER.light, [-0.11, 1.13, -0.51]);
  sphere(group, 0.045, WATER.light, [0.11, 1.13, -0.51]);
  cone(group, 0.11, 0.38, WATER.accent, [-0.18, 1.39, -0.26], [0, 0, -0.2]);
  cone(group, 0.11, 0.38, WATER.accent, [0.18, 1.39, -0.26], [0, 0, 0.2]);
  fin(group, WATER.accent, [-0.53, 0.67, 0], [0, 0, -0.65], [1.2, 1, 0.65]);
  fin(group, WATER.accent, [0.53, 0.67, 0], [0, 0, 0.65], [1.2, 1, 0.65]);
  cone(group, 0.17, 0.48, WATER.body, [0, 0.47, 0.55], [Math.PI / 2, 0, 0]);
  torus(group, 0.35, 0.055, WATER.light, [0, 0.58, 0.03], [Math.PI / 2, 0, 0]);
  return group;
}

function buildTsunamiBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.48, WATER.dark, [0, 0.68, 0], [1.28, 0.92, 0.94]);
  sphere(group, 0.34, WATER.body, [0, 1.2, -0.1], [1.08, 0.94, 0.9]);
  sphere(group, 0.12, WATER.light, [-0.14, 1.22, -0.4], [1, 1, 0.5]);
  sphere(group, 0.12, WATER.light, [0.14, 1.22, -0.4], [1, 1, 0.5]);
  for (const x of [-0.32, 0.32]) {
    cylinder(group, 0.09, 0.5, WATER.body, [x, 0.29, -0.1]);
    fin(group, WATER.accent, [x * 1.48, 0.82, 0], [0, 0, x < 0 ? -0.55 : 0.55], [0.9, 1.15, 0.7]);
  }
  cone(group, 0.15, 0.46, WATER.light, [-0.24, 1.57, 0], [0, 0, -0.18]);
  cone(group, 0.15, 0.46, WATER.light, [0.24, 1.57, 0], [0, 0, 0.18]);
  torus(group, 0.5, 0.045, WATER.accent, [0, 0.68, 0], [Math.PI / 2, 0, 0]);
  return group;
}

function buildSwampBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.47, EARTH.body, [0, 0.67, 0], [1.28, 0.9, 0.94]);
  sphere(group, 0.31, WATER.dark, [0, 1.16, -0.1], [1.02, 0.9, 0.88]);
  sphere(group, 0.12, WATER.light, [-0.13, 1.18, -0.38]);
  sphere(group, 0.12, WATER.light, [0.13, 1.18, -0.38]);
  for (const x of [-0.3, 0.3]) {
    cylinder(group, 0.1, 0.42, EARTH.dark, [x, 0.26, -0.12]);
    fin(group, WATER.accent, [x * 1.42, 0.75, 0.02], [0, 0, x < 0 ? -0.5 : 0.5], [0.8, 1, 0.7]);
  }
  box(group, [0.18, 0.34, 0.18], EARTH.accent, [-0.2, 1.46, 0], [0, 0, -0.2]);
  box(group, [0.18, 0.28, 0.18], EARTH.accent, [0.2, 1.44, 0], [0, 0, 0.2]);
  torus(group, 0.42, 0.06, WATER.accent, [0, 0.68, 0.02], [Math.PI / 2, 0, 0]);
  return group;
}

function buildIceBeast(): THREE.Group {
  const group = new THREE.Group();
  box(group, [0.78, 0.7, 0.7], WATER.body, [0, 0.72, 0], [0, 0.12, 0]);
  box(group, [0.5, 0.48, 0.5], WATER.light, [0, 1.2, -0.08], [0, -0.1, 0]);
  box(group, [0.12, 0.2, 0.08], WATER.dark, [-0.13, 1.22, -0.3]);
  box(group, [0.12, 0.2, 0.08], WATER.dark, [0.13, 1.22, -0.3]);
  for (const x of [-0.28, 0.28]) {
    cylinder(group, 0.09, 0.43, WATER.dark, [x, 0.26, -0.1]);
    cone(group, 0.16, 0.48, WATER.accent, [x * 1.55, 0.84, 0], [0, 0, x < 0 ? -0.55 : 0.55], [0.9, 1.1, 0.8]);
  }
  cone(group, 0.16, 0.48, WATER.accent, [-0.22, 1.56, 0], [0, 0, -0.16]);
  cone(group, 0.16, 0.48, WATER.accent, [0.22, 1.56, 0], [0, 0, 0.16]);
  box(group, [0.12, 0.5, 0.12], WATER.light, [0, 0.74, -0.38], [0.2, 0, 0]);
  return group;
}

function buildStormBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.45, WATER.dark, [0, 0.72, 0], [1.2, 0.94, 0.9]);
  sphere(group, 0.28, LIGHTNING.body, [0, 1.22, -0.1], [1, 0.92, 0.86]);
  sphere(group, 0.06, LIGHTNING.light, [-0.12, 1.24, -0.36]);
  sphere(group, 0.06, LIGHTNING.light, [0.12, 1.24, -0.36]);
  for (const x of [-0.29, 0.29]) {
    cylinder(group, 0.085, 0.44, WATER.body, [x, 0.27, -0.1]);
    box(group, [0.1, 0.1, 0.46], LIGHTNING.accent, [x * 1.4, 0.84, 0.02], [0.45, 0, x < 0 ? -0.2 : 0.2]);
  }
  cone(group, 0.11, 0.4, LIGHTNING.accent, [-0.2, 1.51, 0], [0, 0, -0.22]);
  cone(group, 0.11, 0.4, LIGHTNING.accent, [0.2, 1.51, 0], [0, 0, 0.22]);
  torus(group, 0.48, 0.045, WATER.accent, [0, 0.72, 0], [Math.PI / 2, 0, 0]);
  box(group, [0.1, 0.1, 0.48], LIGHTNING.light, [0, 0.73, 0.48], [0.55, 0, 0]);
  return group;
}

function buildGaleHawk(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.39, AIR.body, [0, 0.65, 0], [1.25, 0.82, 0.8]);
  sphere(group, 0.28, AIR.dark, [0, 1.12, -0.2], [0.94, 0.94, 0.84]);
  cone(group, 0.1, 0.3, LIGHTNING.accent, [0, 1.06, -0.51], [Math.PI / 2, 0, 0]);
  sphere(group, 0.04, AIR.light, [-0.1, 1.16, -0.4]);
  sphere(group, 0.04, AIR.light, [0.1, 1.16, -0.4]);
  box(group, [0.12, 0.38, 0.72], AIR.accent, [-0.5, 0.82, 0], [0.1, 0, -0.3]);
  box(group, [0.12, 0.38, 0.72], AIR.accent, [0.5, 0.82, 0], [-0.1, 0, 0.3]);
  for (const x of [-0.22, 0.22]) {
    cylinder(group, 0.07, 0.38, AIR.dark, [x, 0.23, -0.12]);
  }
  box(group, [0.1, 0.1, 0.58], AIR.light, [0, 0.65, 0.45], [0.55, 0, 0]);
  return group;
}

function buildCloudSprite(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.38, AIR.body, [0, 0.72, 0], [1.22, 0.95, 0.9]);
  sphere(group, 0.24, AIR.light, [-0.27, 0.96, -0.02], [1, 0.9, 0.9]);
  sphere(group, 0.24, AIR.light, [0.27, 0.96, -0.02], [1, 0.9, 0.9]);
  sphere(group, 0.24, AIR.dark, [0, 1.22, -0.08], [0.92, 0.9, 0.82]);
  sphere(group, 0.04, AIR.light, [-0.1, 1.25, -0.36]);
  sphere(group, 0.04, AIR.light, [0.1, 1.25, -0.36]);
  for (const x of [-0.2, 0.2]) {
    cylinder(group, 0.075, 0.34, AIR.dark, [x, 0.25, -0.1]);
  }
  cone(group, 0.12, 0.38, AIR.accent, [-0.19, 1.53, 0], [0, 0, -0.25]);
  cone(group, 0.12, 0.38, AIR.accent, [0.19, 1.53, 0], [0, 0, 0.25]);
  torus(group, 0.4, 0.045, AIR.accent, [0, 0.72, 0], [Math.PI / 2, 0, 0]);
  return group;
}

function buildCycloneBeast(): THREE.Group {
  const group = new THREE.Group();
  cone(group, 0.5, 0.86, AIR.dark, [0, 0.6, 0], [0, 0, 0], [1.05, 1, 0.9]);
  sphere(group, 0.29, AIR.body, [0, 1.13, -0.08], [1.05, 0.9, 0.86]);
  sphere(group, 0.05, AIR.light, [-0.1, 1.16, -0.35]);
  sphere(group, 0.05, AIR.light, [0.1, 1.16, -0.35]);
  torus(group, 0.38, 0.065, AIR.accent, [0, 0.48, 0], [Math.PI / 2, 0, 0]);
  torus(group, 0.3, 0.055, AIR.light, [0, 0.78, 0], [Math.PI / 2, 0, 0]);
  cone(group, 0.14, 0.46, AIR.accent, [-0.2, 1.48, 0], [0, 0, -0.25]);
  cone(group, 0.14, 0.46, AIR.accent, [0.2, 1.48, 0], [0, 0, 0.25]);
  return group;
}

function buildStoneBull(): THREE.Group {
  const group = new THREE.Group();
  box(group, [0.82, 0.7, 0.68], EARTH.body, [0, 0.68, 0], [0, 0.1, 0]);
  box(group, [0.5, 0.47, 0.5], EARTH.accent, [0, 1.18, -0.08], [0, -0.08, 0]);
  cone(group, 0.14, 0.46, EARTH.light, [-0.28, 1.52, -0.02], [0, 0, -0.45]);
  cone(group, 0.14, 0.46, EARTH.light, [0.28, 1.52, -0.02], [0, 0, 0.45]);
  box(group, [0.12, 0.18, 0.08], EARTH.dark, [-0.13, 1.2, -0.3]);
  box(group, [0.12, 0.18, 0.08], EARTH.dark, [0.13, 1.2, -0.3]);
  for (const x of [-0.3, 0.3]) {
    box(group, [0.24, 0.45, 0.24], EARTH.dark, [x, 0.25, -0.1], [0, 0.08 * Math.sign(x), 0]);
  }
  box(group, [0.14, 0.54, 0.12], EARTH.light, [-0.48, 0.72, 0], [0, 0, -0.25]);
  box(group, [0.14, 0.54, 0.12], EARTH.light, [0.48, 0.72, 0], [0, 0, 0.25]);
  return group;
}

function buildMossTortoise(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.49, EARTH.body, [0, 0.58, 0], [1.38, 0.8, 1.02]);
  sphere(group, 0.34, EARTH.accent, [0, 1.06, -0.12], [0.9, 0.84, 0.82]);
  sphere(group, 0.07, EARTH.light, [0, 1.1, -0.39], [1, 1, 0.5]);
  for (const x of [-0.38, 0.38]) {
    cylinder(group, 0.12, 0.28, EARTH.dark, [x, 0.16, -0.18], [0, 0, 0], [1, 1, 0.9]);
    sphere(group, 0.12, EARTH.dark, [x, 0.28, 0.2], [1.1, 0.8, 1]);
  }
  box(group, [0.12, 0.32, 0.12], EARTH.light, [-0.2, 1.42, 0], [0, 0, -0.2]);
  box(group, [0.12, 0.26, 0.12], EARTH.light, [0.22, 1.4, 0], [0, 0, 0.2]);
  torus(group, 0.42, 0.055, EARTH.light, [0, 0.59, 0], [Math.PI / 2, 0, 0]);
  return group;
}

function buildSandstormBeast(): THREE.Group {
  const group = new THREE.Group();
  cone(group, 0.52, 0.92, EARTH.body, [0, 0.61, 0], [0, 0, 0], [1.05, 1, 0.9]);
  sphere(group, 0.3, AIR.dark, [0, 1.18, -0.1], [1, 0.9, 0.88]);
  sphere(group, 0.05, AIR.light, [-0.11, 1.21, -0.38]);
  sphere(group, 0.05, AIR.light, [0.11, 1.21, -0.38]);
  for (const [x, y, rotation] of [
    [-0.37, 0.78, -0.5],
    [0.37, 0.78, 0.5],
  ] as const) {
    box(group, [0.12, 0.46, 0.5], AIR.accent, [x, y, 0], [0, 0, rotation]);
  }
  torus(group, 0.43, 0.06, EARTH.light, [0, 0.52, 0], [Math.PI / 2, 0, 0]);
  cone(group, 0.13, 0.42, EARTH.light, [-0.2, 1.5, 0], [0, 0, -0.2]);
  cone(group, 0.13, 0.42, EARTH.light, [0.2, 1.5, 0], [0, 0, 0.2]);
  return group;
}

function buildCrystalBeast(): THREE.Group {
  const group = new THREE.Group();
  box(group, [0.74, 0.72, 0.62], EARTH.dark, [0, 0.72, 0], [0, 0.12, 0]);
  box(group, [0.48, 0.48, 0.44], LIGHTNING.body, [0, 1.2, -0.06], [0, -0.1, 0]);
  cone(group, 0.14, 0.46, LIGHTNING.light, [-0.2, 1.56, 0], [0, 0, -0.2]);
  cone(group, 0.14, 0.46, LIGHTNING.light, [0.2, 1.56, 0], [0, 0, 0.2]);
  box(group, [0.12, 0.2, 0.08], LIGHTNING.accent, [-0.12, 1.22, -0.27]);
  box(group, [0.12, 0.2, 0.08], LIGHTNING.accent, [0.12, 1.22, -0.27]);
  for (const x of [-0.27, 0.27]) {
    box(group, [0.2, 0.42, 0.2], EARTH.body, [x, 0.26, -0.08], [0, 0.08 * Math.sign(x), 0]);
  }
  box(group, [0.1, 0.52, 0.1], LIGHTNING.light, [-0.2, 0.78, -0.34], [0, 0, -0.22]);
  box(group, [0.1, 0.46, 0.1], LIGHTNING.accent, [0.19, 0.78, -0.34], [0, 0, 0.22]);
  torus(group, 0.38, 0.045, LIGHTNING.accent, [0, 0.72, 0], [Math.PI / 2, 0, 0]);
  return group;
}

function buildVoltBat(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.4, LIGHTNING.body, [0, 0.68, 0], [1.1, 0.92, 0.84]);
  sphere(group, 0.27, LIGHTNING.dark, [0, 1.12, -0.1], [0.94, 0.9, 0.84]);
  sphere(group, 0.045, LIGHTNING.light, [-0.1, 1.15, -0.36]);
  sphere(group, 0.045, LIGHTNING.light, [0.1, 1.15, -0.36]);
  cone(group, 0.1, 0.32, LIGHTNING.accent, [-0.16, 1.4, 0], [0, 0, -0.22]);
  cone(group, 0.1, 0.32, LIGHTNING.accent, [0.16, 1.4, 0], [0, 0, 0.22]);
  box(group, [0.12, 0.54, 0.72], LIGHTNING.accent, [-0.5, 0.74, 0], [0.1, 0, -0.34]);
  box(group, [0.12, 0.54, 0.72], LIGHTNING.accent, [0.5, 0.74, 0], [-0.1, 0, 0.34]);
  for (const x of [-0.2, 0.2]) {
    cylinder(group, 0.075, 0.38, LIGHTNING.dark, [x, 0.23, -0.1]);
  }
  box(group, [0.1, 0.1, 0.62], LIGHTNING.light, [0, 0.67, 0.44], [0.55, 0, 0]);
  return group;
}

function buildThunderBeast(): THREE.Group {
  const group = new THREE.Group();
  sphere(group, 0.45, LIGHTNING.dark, [0, 0.7, 0], [1.2, 0.95, 0.9]);
  sphere(group, 0.29, LIGHTNING.body, [0, 1.2, -0.1], [1, 0.92, 0.88]);
  sphere(group, 0.05, LIGHTNING.light, [-0.11, 1.22, -0.38]);
  sphere(group, 0.05, LIGHTNING.light, [0.11, 1.22, -0.38]);
  for (const x of [-0.29, 0.29]) {
    cylinder(group, 0.085, 0.44, LIGHTNING.body, [x, 0.26, -0.1]);
    box(group, [0.1, 0.1, 0.46], LIGHTNING.accent, [x * 1.35, 0.8, 0], [0.5, 0, x < 0 ? -0.2 : 0.2]);
  }
  cone(group, 0.12, 0.5, LIGHTNING.accent, [-0.2, 1.52, 0], [0, 0, -0.22]);
  cone(group, 0.12, 0.5, LIGHTNING.accent, [0.2, 1.52, 0], [0, 0, 0.22]);
  torus(group, 0.5, 0.05, LIGHTNING.light, [0, 0.7, 0], [Math.PI / 2, 0, 0]);
  box(group, [0.1, 0.1, 0.52], LIGHTNING.accent, [0, 0.72, 0.49], [0.55, 0, 0]);
  return group;
}

function buildModel(cardId: AssignedMonsterId): THREE.Group {
  switch (cardId) {
    case "Ember Imp":
      return buildEmberImp();
    case "Tide Serpent":
      return buildTideSerpent();
    case "Stone Bull":
      return buildStoneBull();
    case "Gale Hawk":
      return buildGaleHawk();
    case "Cloud Sprite":
      return buildCloudSprite();
    case "Reef Guardian":
      return buildReefGuardian();
    case "Moss Tortoise":
      return buildMossTortoise();
    case "Spark Lynx":
      return buildSparkLynx();
    case "Volt Bat":
      return buildVoltBat();
    case "Steam Beast":
      return buildSteamBeast();
    case "Tsunami Beast":
      return buildTsunamiBeast();
    case "Swamp Beast":
      return buildSwampBeast();
    case "Ice Beast":
      return buildIceBeast();
    case "Storm Beast":
      return buildStormBeast();
    case "Golem Beast":
      return buildGolemBeast();
    case "Sandstorm Beast":
      return buildSandstormBeast();
    case "Crystal Beast":
      return buildCrystalBeast();
    case "Cyclone Beast":
      return buildCycloneBeast();
    case "Thunderbird Beast":
      return buildThunderbirdBeast();
    case "Thunder Beast":
      return buildThunderBeast();
    case "Cinder Wall":
      return buildCinderWall();
    case "Inferno Beast":
      return buildInfernoBeast();
    case "Magma Beast":
      return buildMagmaBeast();
    case "Wildfire Beast":
      return buildWildfireBeast();
    case "Plasma Beast":
      return buildPlasmaBeast();
  }
}

function normalizeModel(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  if (size.y <= 0) {
    throw new Error(`Monster model ${group.name || "unknown"} has no height`);
  }

  group.position.x -= center.x;
  group.position.y -= bounds.min.y;
  group.position.z -= center.z;
  group.scale.setScalar(1.6 / size.y);
  group.updateMatrixWorld(true);

  // Correct the small floating-point drift introduced by the uniform scale.
  const normalizedBounds = new THREE.Box3().setFromObject(group);
  const normalizedCenter = normalizedBounds.getCenter(new THREE.Vector3());
  group.position.x -= normalizedCenter.x;
  group.position.y -= normalizedBounds.min.y;
  group.position.z -= normalizedCenter.z;
  group.updateMatrixWorld(true);
  return group;
}

export function createMonsterModel(cardId: string): THREE.Group {
  if (!ASSIGNED_MONSTER_IDS.includes(cardId as AssignedMonsterId)) {
    throw new Error(`Unknown assigned monster card id: ${cardId}`);
  }

  const group = buildModel(cardId as AssignedMonsterId);
  group.name = cardId;
  normalizeModel(group);
  return applyHologramTreatment(
    group,
    getMonsterHologramPalette(cardId as AssignedMonsterId),
  );
}

export function countTriangles(group: THREE.Object3D): number {
  let triangles = 0;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const index = object.geometry.getIndex();
    triangles += index
      ? index.count / 3
      : (object.geometry.getAttribute("position").count / 3);
  });
  return triangles;
}

export const MODEL_HEIGHT = 1.6;
export const MODEL_TRIANGLE_LIMIT = 2000;
export const MODEL_TURN_SPEED = TAU / 22;

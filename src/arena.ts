import * as THREE from "three";

import { createMonsterModel } from "./models";
import {
  createArenaAnimationSystem,
  type ArenaAnimationEvent,
} from "./scene/animations";
import { updateHologramTime } from "./scene/hologram";
import {
  setSummoningSicknessIndicator,
  updateSummoningSicknessIndicator,
} from "./scene/summoning-sickness";
import {
  createArenaLighting,
  type ArenaElement,
} from "./scene/lighting";
import {
  assertMonsterZone,
  createArenaZones,
  monsterZoneKey,
  type ArenaZones,
  type MonsterZone,
  type PlayerSide,
} from "./scene/zones";

const BACKGROUND_COLOR = 0x05070d;
const GRID_SIZE = 24;
const GRID_DIVISIONS = 24;
const GRID_CENTER_COLOR = 0x263b52;
const GRID_LINE_COLOR = 0x152232;
const CAMERA_POSITION = new THREE.Vector3(7, 7, 9);
const CAMERA_TARGET = new THREE.Vector3(0, 0, 0);

interface PlacedMonster {
  object: THREE.Object3D;
  zoneKey: string;
}

export type ArenaAnimationListener = (event: ArenaAnimationEvent) => void;

export interface ArenaScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  floorGrid: THREE.GridHelper;
  zones: ArenaZones;
  placeMonster(
    monsterId: string,
    zone: MonsterZone,
    object?: THREE.Object3D,
  ): THREE.Object3D;
  moveMonster(monsterId: string, zone: MonsterZone): void;
  removeMonster(monsterId: string): THREE.Object3D | undefined;
  releaseMonsterZone(monsterId: string): void;
  stageFusion(
    sourceIds: readonly [string, string],
    resultId: string,
    object?: THREE.Object3D,
  ): THREE.Object3D;
  getMonster(monsterId: string): THREE.Object3D | undefined;
  getMonsterAt(zone: MonsterZone): THREE.Object3D | undefined;
  getMonsterIds(): readonly string[];
  getMonsterZone(monsterId: string): MonsterZone | undefined;
  pickMonsterAt(normalizedX: number, normalizedY: number): string | null;
  setMonsterSummoningSickness(monsterId: string, summoningSick: boolean): void;
  setSideElement(side: PlayerSide, element: ArenaElement): void;
  dispatchAnimation(event: ArenaAnimationEvent): void;
  onAnimationEvent(listener: ArenaAnimationListener): () => void;
  update(elapsedSeconds: number): void;
}

export function createArenaScene(aspect: number): ArenaScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);
  scene.fog = new THREE.FogExp2(BACKGROUND_COLOR, 0.032);

  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
  camera.position.copy(CAMERA_POSITION);
  camera.lookAt(CAMERA_TARGET);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
    new THREE.MeshStandardMaterial({
      color: 0x080c14,
      roughness: 0.72,
      metalness: 0.28,
    }),
  );
  floor.name = "arena-floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  scene.add(floor);

  const floorGrid = new THREE.GridHelper(
    GRID_SIZE,
    GRID_DIVISIONS,
    GRID_CENTER_COLOR,
    GRID_LINE_COLOR,
  );
  const gridMaterial = floorGrid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.35;
  gridMaterial.depthWrite = false;
  scene.add(floorGrid);

  const zones = createArenaZones();
  scene.add(zones.group);

  const lighting = createArenaLighting();
  scene.add(lighting.group);

  const monsterLayer = new THREE.Group();
  monsterLayer.name = "arena-monsters";
  scene.add(monsterLayer);

  const monsters = new Map<string, PlacedMonster>();
  const occupancy = new Map<string, string>();
  const monsterPointer = new THREE.Vector2();
  const monsterRaycaster = new THREE.Raycaster();
  const animations = createArenaAnimationSystem({
    camera,
    getMonster: (monsterId) => monsters.get(monsterId)?.object,
  });
  const animationListeners = new Set<ArenaAnimationListener>();
  scene.add(animations.effectLayer);

  function getZonePosition(zone: MonsterZone): THREE.Vector3 {
    assertMonsterZone(zone);
    return zones.monsterSlots[zone.side][zone.slot].position;
  }

  function placeMonster(
    monsterId: string,
    zone: MonsterZone,
    object?: THREE.Object3D,
  ): THREE.Object3D {
    if (monsterId.length === 0) {
      throw new Error("Monster ID cannot be empty");
    }
    if (monsters.has(monsterId)) {
      throw new Error(`Monster already placed: ${monsterId}`);
    }

    const zoneKey = monsterZoneKey(zone);
    if (occupancy.has(zoneKey)) {
      throw new Error(`Monster zone is occupied: ${zoneKey}`);
    }

    const monster = object ?? createMonsterModel(monsterId);
    monster.position.copy(getZonePosition(zone));
    monster.rotation.set(0, zone.side === "player" ? Math.PI : 0, 0);
    monster.userData.monsterId = monsterId;
    monsterLayer.add(monster);

    monsters.set(monsterId, { object: monster, zoneKey });
    occupancy.set(zoneKey, monsterId);
    return monster;
  }

  function moveMonster(monsterId: string, zone: MonsterZone): void {
    const placement = monsters.get(monsterId);
    if (!placement) {
      throw new Error(`Monster is not placed: ${monsterId}`);
    }

    const destinationKey = monsterZoneKey(zone);
    const occupant = occupancy.get(destinationKey);
    if (occupant && occupant !== monsterId) {
      throw new Error(`Monster zone is occupied: ${destinationKey}`);
    }

    if (occupancy.get(placement.zoneKey) === monsterId) {
      occupancy.delete(placement.zoneKey);
    }
    occupancy.set(destinationKey, monsterId);
    placement.zoneKey = destinationKey;
    placement.object.position.copy(getZonePosition(zone));
    placement.object.rotation.y = zone.side === "player" ? Math.PI : 0;
  }

  function removeMonster(monsterId: string): THREE.Object3D | undefined {
    const placement = monsters.get(monsterId);
    if (!placement) {
      return undefined;
    }

    placement.object.removeFromParent();
    if (occupancy.get(placement.zoneKey) === monsterId) {
      occupancy.delete(placement.zoneKey);
    }
    monsters.delete(monsterId);
    return placement.object;
  }

  function releaseMonsterZone(monsterId: string): void {
    const placement = monsters.get(monsterId);
    if (
      placement &&
      occupancy.get(placement.zoneKey) === monsterId
    ) {
      occupancy.delete(placement.zoneKey);
    }
  }

  function stageFusion(
    sourceIds: readonly [string, string],
    resultId: string,
    object?: THREE.Object3D,
  ): THREE.Object3D {
    const firstSource = monsters.get(sourceIds[0]);
    const secondSource = monsters.get(sourceIds[1]);
    if (!firstSource || !secondSource) {
      throw new Error("Both fusion sources must be placed before the result");
    }

    const [side, slotText] = firstSource.zoneKey.split(":");
    const slot = Number(slotText);
    const zone: MonsterZone = {
      side: side as PlayerSide,
      slot: slot as MonsterZone["slot"],
    };
    assertMonsterZone(zone);
    releaseMonsterZone(sourceIds[0]);
    releaseMonsterZone(sourceIds[1]);
    return placeMonster(resultId, zone, object);
  }

  function getMonsterAt(zone: MonsterZone): THREE.Object3D | undefined {
    const monsterId = occupancy.get(monsterZoneKey(zone));
    return monsterId ? monsters.get(monsterId)?.object : undefined;
  }

  function getMonsterZone(monsterId: string): MonsterZone | undefined {
    const placement = monsters.get(monsterId);
    if (!placement || occupancy.get(placement.zoneKey) !== monsterId) {
      return undefined;
    }
    const [side, slotText] = placement.zoneKey.split(":");
    const zone = { side, slot: Number(slotText) } as MonsterZone;
    assertMonsterZone(zone);
    return zone;
  }

  function pickMonsterAt(normalizedX: number, normalizedY: number): string | null {
    camera.updateMatrixWorld();
    monsterLayer.updateMatrixWorld(true);
    monsterPointer.set(normalizedX, normalizedY);
    monsterRaycaster.setFromCamera(monsterPointer, camera);

    const intersections = monsterRaycaster.intersectObjects(
      [...monsters.values()].map((placement) => placement.object),
      true,
    );

    for (const intersection of intersections) {
      const monsterId = monsterIdForObject(intersection.object);
      if (monsterId) {
        return monsterId;
      }
    }
    return null;
  }

  function monsterIdForObject(object: THREE.Object3D): string | null {
    let candidate: THREE.Object3D | null = object;
    while (candidate) {
      const monsterId = candidate.userData.monsterId;
      if (typeof monsterId === "string" && monsters.has(monsterId)) {
        return monsterId;
      }
      candidate = candidate.parent;
    }
    return null;
  }

  function dispatchAnimation(event: ArenaAnimationEvent): void {
    animations.dispatch(event);
    for (const listener of animationListeners) {
      listener(event);
    }
  }

  function update(elapsedSeconds: number): void {
    camera.position.set(
      CAMERA_POSITION.x + Math.sin(elapsedSeconds * 0.19) * 0.08,
      CAMERA_POSITION.y + Math.sin(elapsedSeconds * 0.13) * 0.035,
      CAMERA_POSITION.z + Math.sin(elapsedSeconds * 0.11) * 0.055,
    );
    camera.lookAt(CAMERA_TARGET);

    for (const placement of monsters.values()) {
      updateHologramTime(placement.object, elapsedSeconds);
      updateSummoningSicknessIndicator(placement.object, elapsedSeconds);
    }
    animations.update(elapsedSeconds);
  }

  return {
    scene,
    camera,
    floorGrid,
    zones,
    placeMonster,
    moveMonster,
    removeMonster,
    releaseMonsterZone,
    stageFusion,
    getMonster: (monsterId) => monsters.get(monsterId)?.object,
    getMonsterAt,
    getMonsterIds: () => [...monsters.keys()],
    getMonsterZone,
    pickMonsterAt,
    setMonsterSummoningSickness(monsterId, summoningSick) {
      const monster = monsters.get(monsterId)?.object;
      if (!monster) {
        return;
      }
      setSummoningSicknessIndicator(monster, summoningSick);
    },
    setSideElement: lighting.setSideElement,
    dispatchAnimation,
    onAnimationEvent(listener) {
      animationListeners.add(listener);
      return () => animationListeners.delete(listener);
    },
    update,
  };
}

export type { ArenaElement } from "./scene/lighting";
export type {
  AnimationAnchor,
  AnimationPoint,
  ArenaAnimationEvent,
  SpellAnimation,
} from "./scene/animations";
export type { MonsterZone, PlayerSide } from "./scene/zones";

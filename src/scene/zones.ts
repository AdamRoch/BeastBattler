import * as THREE from "three";

export type PlayerSide = "player" | "opponent";
export type MonsterSlot = 0 | 1 | 2;

export interface MonsterZone {
  side: PlayerSide;
  slot: MonsterSlot;
}

export interface ArenaZones {
  group: THREE.Group;
  monsterSlots: Record<
    PlayerSide,
    readonly [THREE.Group, THREE.Group, THREE.Group]
  >;
  landRows: Record<PlayerSide, THREE.Group>;
  handAreas: Record<PlayerSide, THREE.Group>;
}

const PLAYER_COLOR = 0x2e9dcc;
const OPPONENT_COLOR = 0xb43f68;
const SLOT_X = [-2.5, 0, 2.5] as const;

function createAreaMarker(
  name: string,
  width: number,
  depth: number,
  color: number,
  opacity: number,
): THREE.Group {
  const marker = new THREE.Group();
  marker.name = name;
  marker.rotation.x = -Math.PI / 2;

  const geometry = new THREE.PlaneGeometry(width, depth);
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  marker.add(fill);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: Math.min(opacity * 4, 0.5),
    }),
  );
  border.position.z = 0.005;
  marker.add(border);

  return marker;
}

function createMonsterMarker(name: string, color: number): THREE.Group {
  const marker = new THREE.Group();
  marker.name = name;
  marker.rotation.x = -Math.PI / 2;

  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
    }),
  );
  marker.add(fill);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 0.92, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.position.z = 0.005;
  marker.add(ring);

  return marker;
}

function createSideZones(
  side: PlayerSide,
  direction: 1 | -1,
  color: number,
): {
  monsterSlots: [THREE.Group, THREE.Group, THREE.Group];
  landRow: THREE.Group;
  handArea: THREE.Group;
} {
  const monsterSlots = SLOT_X.map((x, slot) => {
    const marker = createMonsterMarker(`${side}-monster-${slot}`, color);
    marker.position.set(x, 0.035, direction * 1.45);
    return marker;
  }) as [THREE.Group, THREE.Group, THREE.Group];

  const landRow = createAreaMarker(
    `${side}-land-row`,
    7.4,
    1.05,
    color,
    0.04,
  );
  landRow.position.set(0, 0.03, direction * 3.25);

  const handArea = createAreaMarker(
    `${side}-hand-area`,
    8.6,
    1.25,
    color,
    0.025,
  );
  handArea.position.set(0, 0.03, direction * 4.65);

  return { monsterSlots, landRow, handArea };
}

export function createArenaZones(): ArenaZones {
  const group = new THREE.Group();
  group.name = "arena-zones";

  const player = createSideZones("player", 1, PLAYER_COLOR);
  const opponent = createSideZones("opponent", -1, OPPONENT_COLOR);

  group.add(
    ...player.monsterSlots,
    player.landRow,
    player.handArea,
    ...opponent.monsterSlots,
    opponent.landRow,
    opponent.handArea,
  );

  return {
    group,
    monsterSlots: {
      player: player.monsterSlots,
      opponent: opponent.monsterSlots,
    },
    landRows: {
      player: player.landRow,
      opponent: opponent.landRow,
    },
    handAreas: {
      player: player.handArea,
      opponent: opponent.handArea,
    },
  };
}

export function assertMonsterZone(zone: MonsterZone): void {
  if (
    (zone.side !== "player" && zone.side !== "opponent") ||
    !Number.isInteger(zone.slot) ||
    zone.slot < 0 ||
    zone.slot > 2
  ) {
    throw new RangeError(
      `Invalid monster zone: ${String(zone.side)} slot ${String(zone.slot)}`,
    );
  }
}

export function monsterZoneKey(zone: MonsterZone): string {
  assertMonsterZone(zone);
  return `${zone.side}:${zone.slot}`;
}
